/**
 * Authentication service. Cookie-free on purpose: the Next.js layer (lib/auth/session.ts)
 * owns cookies, this layer owns credentials, sessions and lockout.
 */
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { DUMMY_HASH, generateToken, hashIp, hashPassword, hmac, verifyPassword } from "@/lib/auth/crypto";
import { AppError, invalid, loginLocked } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clearLoginThrottle, recordFailure, reserveAttempt } from "./login-throttle";
import { changePasswordSchema, loginSchema } from "@/lib/validation/auth";
import type { AuthContext } from "@/lib/rbac/authorize";
import { effectiveAssignmentPermissions } from "@/lib/rbac/permissions";
import type { Assignment } from "@/lib/rbac/scope";

export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000; // hard cap per login
export const SESSION_IDLE_MS = 30 * 60 * 1000; // sign out after inactivity
const TOUCH_INTERVAL_MS = 60 * 1000;
/** Newest sessions kept per user; signing in on a further device ends the oldest one. */
export const MAX_ACTIVE_SESSIONS = 3;

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

  // Broad per-source flood limit, before touching credentials.
  await enforceRateLimit(`login:ip:${hashIp(meta.ip) ?? "unknown"}`, 30, 15 * 60);

  // Per-account limit: MAX_LOGIN_ATTEMPTS attempts, then a LOCKOUT_SECONDS lock during which NO attempt
  // is evaluated (the password is not even checked). Reserved atomically before verification.
  const reservation = await reserveAttempt(email);
  if (!reservation.allowed) {
    await writeAudit({
      action: "LOGIN_FAILED",
      resource: "User",
      metadata: { reason: "locked" },
      ip: meta.ip,
    });
    throw loginLocked(reservation.retryAfterSeconds);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Always run one bcrypt comparison so response time does not reveal whether the account exists.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  const now = new Date();
  const usable = user && user.status === "ACTIVE" && !user.deletedAt;
  // An administrator-issued temporary password is only good for a limited time.
  const tempExpired =
    !!user?.mustChangePassword && !!user.tempPasswordExpiresAt && user.tempPasswordExpiresAt <= now;

  if (!user || !usable || tempExpired || !passwordOk) {
    const lockSeconds = await recordFailure(email, reservation.attempt);
    if (lockSeconds && user) {
      await writeAudit({
        actorId: user.id,
        action: "ACCOUNT_LOCKED",
        resource: "User",
        resourceId: user.id,
        metadata: { seconds: lockSeconds },
        ip: meta.ip,
      });
    }
    await writeAudit({
      actorId: user?.id ?? null,
      action: "LOGIN_FAILED",
      resource: "User",
      resourceId: user?.id ?? null,
      metadata: {
        reason: !user
          ? "unknown_user"
          : !usable
            ? "inactive"
            : tempExpired && passwordOk
              ? "temporary_password_expired"
              : "bad_password",
        attempt: reservation.attempt,
      },
      ip: meta.ip,
    });
    // Same message for every failure mode: no account enumeration.
    if (lockSeconds) throw loginLocked(lockSeconds);
    throw new AppError(INVALID_CREDENTIALS, "UNAUTHENTICATED");
  }

  await clearLoginThrottle(email);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  await enforceSessionCap(user.id, now);

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

  const liveRoles = user.roles.filter((ur) => !ur.role.deletedAt);
  // a permission whose prerequisite the user does not hold anywhere grants nothing (see PERMISSION_REQUIRES)
  const effective = effectiveAssignmentPermissions(
    liveRoles.map((ur) => ur.role.permissions.map((rp) => rp.permission.key)),
  );
  const assignments: Assignment[] = liveRoles.map((ur, i) => ({
    roleKey: ur.role.key,
    scopeType: ur.scopeType,
    districtId: ur.districtId,
    branchId: ur.branchId,
    departmentId: ur.departmentId,
    permissions: effective[i],
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

/** Keeps at most MAX_ACTIVE_SESSIONS - 1 existing live sessions so the one being created is the newest. */
async function enforceSessionCap(userId: string, now: Date): Promise<void> {
  const live = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const excess = live.slice(MAX_ACTIVE_SESSIONS - 1);
  if (excess.length)
    await prisma.session.updateMany({
      where: { id: { in: excess.map((s) => s.id) } },
      data: { revokedAt: now },
    });
}

/**
 * Step-up check for sensitive operations: the signed-in actor must re-enter their own password.
 * Throttled, and failures are audited at high severity (a hijacked session trying to pivot).
 */
export async function requireReauthentication(
  ctx: AuthContext,
  password: unknown,
  meta: RequestMeta = {},
): Promise<void> {
  await enforceRateLimit(`reauth:${ctx.userId}`, 5, 15 * 60);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (typeof password !== "string" || !password || !(await verifyPassword(password, user.passwordHash))) {
    await writeAudit({
      actorId: ctx.userId,
      action: "REAUTH_FAILED",
      resource: "User",
      resourceId: ctx.userId,
      ip: meta.ip,
    });
    throw invalid("Please correct the highlighted fields.", {
      currentPassword: ["Your password is incorrect."],
    });
  }
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
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      tempPasswordExpiresAt: null,
    },
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
