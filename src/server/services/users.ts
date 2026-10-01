import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { generateTemporaryPassword, generateToken, hashPassword } from "@/lib/auth/crypto";
import { emailEnabled } from "@/lib/mail/mailer";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import {
  actorCoversRole,
  actorHoldsAll,
  can,
  requirePermission,
  type AuthContext,
} from "@/lib/rbac/authorize";
import { branchWhere, departmentWhere, districtWhere, type AccessScope } from "@/lib/rbac/scope";
import { ALL_LOCATIONS } from "@/lib/validation/location";
import {
  createUserSchema,
  resetUserPasswordSchema,
  updateUserSchema,
  type ScopeInput,
} from "@/lib/validation/admin";
import { parse } from "@/lib/validation/parse";
import { Prisma } from "@/generated/prisma/client";
import { clearLoginThrottle } from "./login-throttle";
import { requireReauthentication, revokeAllSessions, type RequestMeta } from "./auth";
import { sendAdminReset, sendInvite } from "./password-reset";

/** An administrator-issued temporary password (no-email deployments) stops working after this long. */
export const TEMP_PASSWORD_HOURS = 24;
const tempPasswordExpiry = () => new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600_000);
import { expandAllLocations, resolveTarget } from "./targets";

const userInclude = {
  roles: {
    include: {
      role: { select: { id: true, key: true, name: true } },
      district: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.UserInclude;

/** Users are visible if some assignment falls in the actor's scope (bank-wide actors see all). */
export async function listUsers(ctx: AuthContext) {
  const scope = requirePermission(ctx, "user.view");
  const d = [...scope.districtIds];
  const b = [...scope.branchIds];
  const dep = [...scope.departmentIds];
  const where: Prisma.UserWhereInput = scope.all
    ? { deletedAt: null }
    : {
        deletedAt: null,
        roles: {
          some: {
            OR: [
              { districtId: { in: d } },
              { branchId: { in: b } },
              { departmentId: { in: dep } },
              { branch: { districtId: { in: d } } },
              { department: { districtId: { in: d } } },
            ],
          },
        },
      };
  const users = await prisma.user.findMany({
    where,
    orderBy: { name: "asc" },
    include: userInclude,
    omit: { passwordHash: true },
  });
  return users;
}

/** Union of the actor's user.create / user.update reach: where they may place users. */
function assignableScope(ctx: AuthContext): AccessScope {
  const scopes = (["user.create", "user.update"] as const).flatMap((p) =>
    can(ctx, p) ? [requirePermission(ctx, p)] : [],
  );
  if (scopes.length === 0) throw forbidden();
  return {
    all: scopes.some((s) => s.all),
    districtIds: new Set(scopes.flatMap((s) => [...s.districtIds])),
    branchIds: new Set(scopes.flatMap((s) => [...s.branchIds])),
    departmentIds: new Set(scopes.flatMap((s) => [...s.departmentIds])),
  };
}

/**
 * Options for the user form: roles the actor could grant and locations inside their reach.
 * Convenience only — createUser/updateUser re-validate every assignment server-side.
 */
export async function listAssignmentOptions(ctx: AuthContext) {
  const scope = assignableScope(ctx);

  const [roles, districts, branches, departments] = await Promise.all([
    prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    }),
    prisma.district.findMany({
      where: { deletedAt: null, ...districtWhere(scope) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { deletedAt: null, ...branchWhere(scope) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { deletedAt: null, ...departmentWhere(scope) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return {
    roles: roles
      .filter((r) =>
        actorHoldsAll(
          ctx,
          r.permissions.map((p) => p.permission.key),
        ),
      )
      .map((r) => ({ id: r.id, name: r.name })),
    districts,
    branches,
    departments,
    canAssignAll: scope.all,
  };
}

async function rolePermissionKeys(roleId: string): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  return rows.map((r) => r.permission.key);
}

/**
 * "All districts/branches/departments" becomes one assignment per location. Only locations where the
 * actor may grant that role are included, so a scoped administrator's "All" stays inside their reach.
 */
async function expandAssignments(ctx: AuthContext, list: ScopeInput[]): Promise<ScopeInput[]> {
  const out: ScopeInput[] = [];
  for (const a of list) {
    const field = (
      { DISTRICT: "districtId", BRANCH: "branchId", DEPARTMENT: "departmentId", ALL: null } as const
    )[a.scopeType];
    if (!field || a[field] !== ALL_LOCATIONS) {
      out.push(a);
      continue;
    }
    const role = await prisma.role.findFirst({ where: { id: a.roleId, deletedAt: null } });
    if (!role) throw notFound("Role");
    const permissions = await rolePermissionKeys(role.id);
    const ids = await expandAllLocations(
      a.scopeType as "DISTRICT" | "BRANCH" | "DEPARTMENT",
      assignableScope(ctx),
    );
    let granted = 0;
    for (const id of ids) {
      const row = { ...a, districtId: null, branchId: null, departmentId: null, [field]: id };
      if (!actorCoversRole(ctx, permissions, await resolveTarget(row))) continue;
      out.push(row);
      granted++;
    }
    if (granted === 0) throw forbidden("You cannot assign a role with more access than you hold.");
  }
  // "All" next to an explicit entry must not create the same assignment twice
  const seen = new Set<string>();
  return out.filter((a) => {
    const k = [a.roleId, a.scopeType, a.districtId, a.branchId, a.departmentId].join("|");
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/** Every assignment the actor is about to grant must be within the actor's own reach. */
async function assertCanGrant(ctx: AuthContext, assignments: ScopeInput[]) {
  for (const a of assignments) {
    const role = await prisma.role.findFirst({ where: { id: a.roleId, deletedAt: null } });
    if (!role) throw notFound("Role");
    const target = await resolveTarget(a);
    if (!actorCoversRole(ctx, await rolePermissionKeys(role.id), target)) {
      throw forbidden("You cannot assign a role with more access than you hold.");
    }
  }
}

/** The actor must already cover everything the target user currently holds. */
async function assertCanManage(ctx: AuthContext, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { roles: true },
  });
  if (!user) throw notFound("User");
  for (const a of user.roles) {
    const target = await resolveTarget(a);
    if (!actorCoversRole(ctx, await rolePermissionKeys(a.roleId), target)) {
      throw forbidden("You cannot manage a user with more access than you hold.");
    }
  }
  return user;
}

const toRows = (list: ScopeInput[]) =>
  list.map((a) => ({
    roleId: a.roleId,
    scopeType: a.scopeType,
    districtId: a.districtId ?? null,
    branchId: a.branchId ?? null,
    departmentId: a.departmentId ?? null,
  }));

export async function createUser(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "user.create");
  const data = parse(createUserSchema, input);
  // With email available the user chooses their own password from an invitation link, so nobody
  // (including the administrator) ever handles it. Without email we fall back to an admin-set password.
  const inviteMode = emailEnabled();
  if (!inviteMode && !data.password) {
    throw invalid("Please correct the highlighted fields.", { password: ["Enter a temporary password."] });
  }
  const assignments = await expandAssignments(ctx, data.assignments);
  await assertCanGrant(ctx, assignments);
  let user;
  try {
    user = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        // invite mode: an unguessable placeholder until the user sets a real password
        passwordHash: await hashPassword(inviteMode ? generateToken() : data.password!),
        mustChangePassword: true,
        tempPasswordExpiresAt: inviteMode ? null : tempPasswordExpiry(),
        roles: { create: toRows(assignments) },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw conflict("A user with this email already exists.");
    throw e;
  }
  await writeAudit({
    actorId: ctx.userId,
    action: "USER_CREATED",
    resource: "User",
    resourceId: user.id,
    metadata: { email: user.email, assignments, invited: inviteMode },
  });
  // A failed email must not undo the account: report it so the administrator can resend.
  const emailSent = inviteMode ? await sendInvite(user, ctx.userId) : null;
  return { id: user.id, inviteMode, emailSent };
}

/** Emails a fresh "set your password" link to a user who has not signed in yet. */
export async function resendInvite(ctx: AuthContext, id: string) {
  requirePermission(ctx, "user.update");
  if (!emailEnabled()) throw invalid("Email is not configured on this system.");
  const user = await assertCanManage(ctx, id);
  if (user.status !== "ACTIVE") throw invalid("Activate the user first.");
  if (user.lastLoginAt) throw invalid("This user has already signed in. Use “Reset password” instead.");
  if (!(await sendInvite(user, ctx.userId)))
    throw invalid("The email could not be sent. Please try again later.");
}

export async function updateUser(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "user.update");
  const data = parse(updateUserSchema, input);
  const existing = await assertCanManage(ctx, id);
  if (id === ctx.userId) {
    // Editing your own assignments would allow self-escalation or accidental lock-out.
    throw forbidden("You cannot change your own roles.");
  }
  const assignments = await expandAssignments(ctx, data.assignments);
  await assertCanGrant(ctx, assignments);
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { name: data.name } }),
    prisma.userRole.deleteMany({ where: { userId: id } }),
    prisma.userRole.createMany({ data: toRows(assignments).map((r) => ({ ...r, userId: id })) }),
  ]);
  await writeAudit({
    actorId: ctx.userId,
    action: "USER_UPDATED",
    resource: "User",
    resourceId: id,
    metadata: { email: existing.email, name: data.name },
  });
  await writeAudit({
    actorId: ctx.userId,
    action: "USER_ROLES_CHANGED",
    resource: "User",
    resourceId: id,
    metadata: { assignments },
  });
}

export async function setUserActive(ctx: AuthContext, id: string, active: boolean) {
  requirePermission(ctx, "user.deactivate");
  if (id === ctx.userId) throw forbidden("You cannot deactivate your own account.");
  const existing = await assertCanManage(ctx, id);
  await prisma.user.update({
    where: { id },
    data: { status: active ? "ACTIVE" : "INACTIVE" },
  });
  await clearLoginThrottle(existing.email);
  if (!active) await revokeAllSessions(id); // takes effect immediately
  await writeAudit({
    actorId: ctx.userId,
    action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    resource: "User",
    resourceId: id,
    metadata: { email: existing.email },
  });
}

export interface PasswordResetResult {
  /** Present only when email is not configured; shown once to the administrator. */
  temporaryPassword: string | null;
  /** True when the user was emailed a one-time link instead (the administrator never sees a password). */
  emailSent: boolean;
  validForHours: number | null;
}

/**
 * Resets another user's password. Sensitive, so:
 *  - the administrator must re-enter their own password (step-up),
 *  - with email configured the user receives a one-time link and nobody sees a password,
 *  - otherwise a temporary password is issued that expires after TEMP_PASSWORD_HOURS,
 *  - all of the user's sessions end, and the action is audited at high severity (which alerts).
 */
export async function resetUserPassword(
  ctx: AuthContext,
  id: string,
  input: unknown,
  meta: RequestMeta = {},
): Promise<PasswordResetResult> {
  requirePermission(ctx, "user.update");
  if (id === ctx.userId) throw invalid("Use “Change password” to update your own password.");
  const { currentPassword } = parse(resetUserPasswordSchema, input);
  const existing = await assertCanManage(ctx, id);
  await requireReauthentication(ctx, currentPassword, meta);

  let result: PasswordResetResult;
  if (emailEnabled()) {
    // deliver first: if the mail server refuses, the account is left untouched
    if (!(await sendAdminReset(existing)))
      throw invalid("The email could not be sent. Please try again later.");
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(generateToken()), // the old password stops working now
        mustChangePassword: true,
        tempPasswordExpiresAt: null,
      },
    });
    result = { temporaryPassword: null, emailSent: true, validForHours: null };
  } else {
    const temporaryPassword = generateTemporaryPassword();
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        tempPasswordExpiresAt: tempPasswordExpiry(),
      },
    });
    result = { temporaryPassword, emailSent: false, validForHours: TEMP_PASSWORD_HOURS };
  }
  await revokeAllSessions(id);
  await clearLoginThrottle(existing.email);
  await writeAudit({
    actorId: ctx.userId,
    action: "USER_PASSWORD_RESET",
    resource: "User",
    resourceId: id,
    metadata: { email: existing.email, delivery: result.emailSent ? "email" : "temporary_password" },
    ip: meta.ip,
  });
  return result;
}
