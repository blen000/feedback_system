/**
 * Authentication service. Cookie-free on purpose: the Next.js layer (lib/auth/session.ts)
 * owns cookies, this layer owns credentials, sessions and lockout.
 */
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { DUMMY_HASH, generateToken, hashIp, hashPassword, hmac, verifyPassword } from "@/lib/auth/crypto";
import { AppError, invalid } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { changePasswordSchema, loginSchema } from "@/lib/validation/auth";
import type { AuthContext } from "@/lib/rbac/authorize";
import type { Assignment } from "@/lib/rbac/scope";

export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000; // hard cap per login
export const SESSION_IDLE_MS = 30 * 60 * 1000; // sign out after inactivity
const TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const INVALID_CREDENTIALS = "Invalid email or password.";

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  mustChangePassword: boolean;
}

export async function login(input: unknown, meta: RequestMeta = {}): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new AppError(INVALID_CREDENTIALS, "UNAUTHENTICATED");
  const { email, password } = parsed.data;

  // Throttle by source and by target account, before touching credentials.
  const ipKey = hashIp(meta.ip) ?? "unknown";
  await enforceRateLimit(`login:ip:${ipKey}`, 30, 15 * 60);
  await enforceRateLimit(`login:email:${hmac(email).slice(0, 24)}`, 10, 15 * 60);

  const user = await prisma.user.findUnique({ where: { email } });
  // Always run one bcrypt comparison so response time does not reveal whether the account exists.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  const now = new Date();
  const usable = user && user.status === "ACTIVE" && !user.deletedAt;
  const locked = user?.lockedUntil && user.lockedUntil > now;

  if (!user || !usable || locked || !passwordOk) {
    if (user && usable && !locked && !passwordOk) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED_LOGINS
            ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) }
            : { failedLoginCount: failed },
      });
    }
    await writeAudit({
      actorId: user?.id ?? null,
      action: "LOGIN_FAILED",
      resource: "User",
      resourceId: user?.id ?? null,
      metadata: {
        reason: !user ? "unknown_user" : !usable ? "inactive" : locked ? "locked" : "bad_password",
      },
      ip: meta.ip,
    });
    // Same message for every failure mode: no account enumeration.
    throw new AppError(INVALID_CREDENTIALS, "UNAUTHENTICATED");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hmac(token),
      expiresAt,
      ipHash: hashIp(meta.ip),
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
    },
  });
  await writeAudit({ actorId: user.id, action: "LOGIN", resource: "User", resourceId: user.id, ip: meta.ip });

  return { token, expiresAt, mustChangePassword: user.mustChangePassword };
}

/**
 * Resolves a session cookie value to an AuthContext, or null when the session is
 * missing, revoked, expired (absolute or idle), or the account is no longer usable.
 * Permissions are re-read from the database on every call: revocations apply immediately.
 */
export async function authenticateToken(token: string | undefined | null): Promise<AuthContext | null> {
  if (!token) return null;
  const now = new Date();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hmac(token) },
    include: {
      user: {
        include: {
          roles: {
            include: { role: { include: { permissions: { include: { permission: true } } } } },
          },
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  if (now.getTime() - session.lastUsedAt.getTime() > SESSION_IDLE_MS) return null;
  const { user } = session;
  if (user.status !== "ACTIVE" || user.deletedAt) return null;

  if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
  }

  const assignments: Assignment[] = user.roles
    .filter((ur) => !ur.role.deletedAt)
    .map((ur) => ({
      roleKey: ur.role.key,
      scopeType: ur.scopeType,
      districtId: ur.districtId,
      branchId: ur.branchId,
      departmentId: ur.departmentId,
      permissions: new Set(ur.role.permissions.map((rp) => rp.permission.key)),
    }));

  return {
    userId: user.id,
    sessionId: session.id,
    email: user.email,
    name: user.name,
    mustChangePassword: user.mustChangePassword,
    assignments,
  };
}

export async function logout(token: string | undefined | null, meta: RequestMeta = {}): Promise<void> {
  if (!token) return;
  const session = await prisma.session.findUnique({ where: { tokenHash: hmac(token) } });
  if (!session || session.revokedAt) return;
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await writeAudit({
    actorId: session.userId,
    action: "LOGOUT",
    resource: "User",
    resourceId: session.userId,
    ip: meta.ip,
  });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/** Self-service password change. Revokes all other sessions. */
export async function changeOwnPassword(
  ctx: AuthContext,
  input: unknown,
  meta: RequestMeta = {},
): Promise<void> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success)
    throw invalid("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors);
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw invalid("Please correct the highlighted fields.", {
      currentPassword: ["Current password is incorrect."],
    });
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw invalid("Please correct the highlighted fields.", {
      newPassword: ["New password must be different from the current one."],
    });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
  await revokeAllSessions(user.id, ctx.sessionId);
  await writeAudit({
    actorId: user.id,
    action: "PASSWORD_CHANGED",
    resource: "User",
    resourceId: user.id,
    ip: meta.ip,
  });
}
