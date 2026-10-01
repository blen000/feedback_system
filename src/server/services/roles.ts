import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { actorHoldsAll, requirePermission, type AuthContext } from "@/lib/rbac/authorize";
import { incompletePermissions, PERMISSION_CATALOG } from "@/lib/rbac/permissions";
import { roleSchema } from "@/lib/validation/admin";
import { parse } from "@/lib/validation/parse";
import { Prisma } from "@/generated/prisma/client";

const roleInclude = {
  permissions: { include: { permission: { select: { key: true } } } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleInclude;

export async function listRoles(ctx: AuthContext) {
  requirePermission(ctx, "role.view");
  const roles = await prisma.role.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: roleInclude,
  });
  return roles.map(present);
}

export async function listPermissions(ctx: AuthContext) {
  // Needed to render the role editor and the user form; gated like the roles pages.
  requirePermission(ctx, "role.view");
  // only permissions the application actually enforces (old rows may linger in the table)
  const rows = await prisma.permission.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
  return rows.filter((p) =>
    (PERMISSION_CATALOG as Record<string, readonly string[]>)[p.group]?.includes(p.key.split(".")[1]),
  );
}

function present(r: Prisma.RoleGetPayload<{ include: typeof roleInclude }>) {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    userCount: r._count.users,
    permissions: r.permissions.map((p) => p.permission.key).sort(),
  };
}

/** A role must be usable: every permission comes with the ones its page needs (see PERMISSION_REQUIRES). */
function assertComplete(keys: string[]) {
  const gaps = incompletePermissions(keys);
  if (gaps.length)
    throw invalid("Some permissions need others.", {
      permissions: gaps.map((g) => `${g.key} also requires ${g.missing.join(", ")}`),
    });
}

async function assertPermissionsExist(keys: string[]) {
  const found = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { key: true } });
  const missing = keys.filter((k) => !found.some((f) => f.key === k));
  if (missing.length)
    throw invalid("Unknown permission.", { permissions: [`Unknown permission: ${missing[0]}`] });
}

export async function createRole(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "role.create");
  const data = parse(roleSchema, input);
  const keys = [...new Set(data.permissions)];
  await assertPermissionsExist(keys);
  // cannot mint a role more powerful than yourself
  if (!actorHoldsAll(ctx, keys)) throw forbidden("You can only grant permissions that you hold yourself.");
  assertComplete(keys);

  try {
    const role = await prisma.role.create({
      data: {
        key: data.key,
        name: data.name,
        description: data.description ?? null,
        permissions: { create: (await permissionIds(keys)).map((permissionId) => ({ permissionId })) },
      },
      include: roleInclude,
    });
    await writeAudit({
      actorId: ctx.userId,
      action: "ROLE_CREATED",
      resource: "Role",
      resourceId: role.id,
      metadata: { key: role.key, permissions: keys },
    });
    return present(role);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw conflict("A role with this key already exists.");
    throw e;
  }
}

async function permissionIds(keys: string[]) {
  const rows = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function updateRole(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "role.update");
  const existing = await prisma.role.findFirst({ where: { id, deletedAt: null }, include: roleInclude });
  if (!existing) throw notFound("Role");
  const data = parse(roleSchema.omit({ key: true }), input);
  const keys = [...new Set(data.permissions)];
  await assertPermissionsExist(keys);

  const current = existing.permissions.map((p) => p.permission.key);
  // Hierarchy: you may edit a role only if you hold everything it has, and everything you give it.
  if (!actorHoldsAll(ctx, [...current, ...keys])) {
    throw forbidden("You can only edit roles whose permissions you hold yourself.");
  }
  assertComplete(keys);
  // Lock-out protection: the SUPER_ADMIN role must keep every permission.
  if (existing.key === "SUPER_ADMIN" && current.some((k) => !keys.includes(k))) {
    throw conflict("The Super Admin role must keep all permissions.");
  }

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.role.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description ?? null,
        permissions: { create: (await permissionIds(keys)).map((permissionId) => ({ permissionId })) },
      },
    }),
  ]);
  await writeAudit({
    actorId: ctx.userId,
    action: "ROLE_UPDATED",
    resource: "Role",
    resourceId: id,
    metadata: {
      added: keys.filter((k) => !current.includes(k)),
      removed: current.filter((k) => !keys.includes(k)),
    },
  });
}

export async function deleteRole(ctx: AuthContext, id: string) {
  requirePermission(ctx, "role.delete");
  const existing = await prisma.role.findFirst({ where: { id, deletedAt: null }, include: roleInclude });
  if (!existing) throw notFound("Role");
  if (existing.isSystem) throw conflict("System roles cannot be deleted.");
  if (existing._count.users > 0) throw conflict("This role is still assigned to users. Reassign them first.");
  if (
    !actorHoldsAll(
      ctx,
      existing.permissions.map((p) => p.permission.key),
    )
  )
    throw forbidden();
  await prisma.role.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit({
    actorId: ctx.userId,
    action: "ROLE_DELETED",
    resource: "Role",
    resourceId: id,
    metadata: { key: existing.key },
  });
}
