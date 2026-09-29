/**
 * Districts, branches and departments. Reads are filtered in the database by the actor's
 * scope; writes require the permission to cover the specific target location.
 */
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { requirePermission, requirePermissionOn, type AuthContext } from "@/lib/rbac/authorize";
import { branchWhere, departmentWhere, districtWhere } from "@/lib/rbac/scope";
import {
  branchSchema,
  departmentSchema,
  districtSchema,
  type BranchInput,
  type DepartmentInput,
  type DistrictInput,
} from "@/lib/validation/admin";
import { parse } from "@/lib/validation/parse";
import { Prisma } from "@/generated/prisma/client";

/** Converts unique-constraint violations into a friendly conflict error. */
async function uniqueGuard<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw conflict(`${what} code is already in use.`);
    }
    throw e;
  }
}

// ───────────────────────── Districts ─────────────────────────

export async function listDistricts(ctx: AuthContext) {
  const scope = requirePermission(ctx, "district.view");
  return prisma.district.findMany({
    where: { deletedAt: null, ...districtWhere(scope) },
    orderBy: { name: "asc" },
    include: { _count: { select: { branches: { where: { deletedAt: null } } } } },
  });
}

export async function createDistrict(ctx: AuthContext, input: unknown) {
  const scope = requirePermission(ctx, "district.create");
  if (!scope.all) throw forbidden(); // a new district is a bank-level object
  const data = parse(districtSchema, input);
  const row = await uniqueGuard(() => prisma.district.create({ data }), "District");
  await writeAudit({
    actorId: ctx.userId,
    action: "DISTRICT_CREATED",
    resource: "District",
    resourceId: row.id,
    metadata: data,
  });
  return row;
}

export async function updateDistrict(ctx: AuthContext, id: string, input: unknown) {
  const existing = await prisma.district.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("District");
  requirePermissionOn(ctx, "district.update", { type: "DISTRICT", districtId: id });
  const data: DistrictInput = parse(districtSchema, input);
  const row = await uniqueGuard(() => prisma.district.update({ where: { id }, data }), "District");
  await writeAudit({
    actorId: ctx.userId,
    action: "DISTRICT_UPDATED",
    resource: "District",
    resourceId: id,
    metadata: data,
  });
  return row;
}

export async function deleteDistrict(ctx: AuthContext, id: string) {
  const existing = await prisma.district.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("District");
  requirePermissionOn(ctx, "district.delete", { type: "DISTRICT", districtId: id });
  const [branches, departments] = await Promise.all([
    prisma.branch.count({ where: { districtId: id, deletedAt: null } }),
    prisma.department.count({ where: { districtId: id, deletedAt: null } }),
  ]);
  if (branches + departments > 0) {
    throw conflict("This district still has branches or departments. Move or delete them first.");
  }
  await prisma.district.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await prisma.qRCode.updateMany({ where: { districtId: id }, data: { isActive: false } });
  await writeAudit({
    actorId: ctx.userId,
    action: "DISTRICT_DELETED",
    resource: "District",
    resourceId: id,
    metadata: { code: existing.code },
  });
}

// ───────────────────────── Branches ─────────────────────────

export async function listBranches(ctx: AuthContext, filter: { districtId?: string } = {}) {
  const scope = requirePermission(ctx, "branch.view");
  return prisma.branch.findMany({
    where: {
      deletedAt: null,
      ...(filter.districtId ? { districtId: filter.districtId } : {}),
      ...branchWhere(scope),
    },
    orderBy: [{ district: { name: "asc" } }, { name: "asc" }],
    include: { district: { select: { id: true, name: true } } },
  });
}

async function activeDistrictOrThrow(id: string) {
  const d = await prisma.district.findFirst({ where: { id, deletedAt: null } });
  if (!d) throw notFound("District");
  return d;
}

export async function createBranch(ctx: AuthContext, input: unknown) {
  const data: BranchInput = parse(branchSchema, input);
  await activeDistrictOrThrow(data.districtId);
  requirePermissionOn(ctx, "branch.create", { type: "DISTRICT", districtId: data.districtId });
  const row = await uniqueGuard(() => prisma.branch.create({ data }), "Branch");
  await writeAudit({
    actorId: ctx.userId,
    action: "BRANCH_CREATED",
    resource: "Branch",
    resourceId: row.id,
    metadata: data,
  });
  return row;
}

export async function updateBranch(ctx: AuthContext, id: string, input: unknown) {
  const existing = await prisma.branch.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("Branch");
  requirePermissionOn(ctx, "branch.update", {
    type: "BRANCH",
    branchId: id,
    districtId: existing.districtId,
  });
  const data: BranchInput = parse(branchSchema, input);
  if (data.districtId !== existing.districtId) {
    // moving a branch: the actor must also control the destination district
    await activeDistrictOrThrow(data.districtId);
    requirePermissionOn(ctx, "branch.update", { type: "DISTRICT", districtId: data.districtId });
  }
  const row = await uniqueGuard(() => prisma.branch.update({ where: { id }, data }), "Branch");
  await writeAudit({
    actorId: ctx.userId,
    action: "BRANCH_UPDATED",
    resource: "Branch",
    resourceId: id,
    metadata: data,
  });
  return row;
}

export async function deleteBranch(ctx: AuthContext, id: string) {
  const existing = await prisma.branch.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("Branch");
  requirePermissionOn(ctx, "branch.delete", {
    type: "BRANCH",
    branchId: id,
    districtId: existing.districtId,
  });
  await prisma.$transaction([
    prisma.branch.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    prisma.qRCode.updateMany({ where: { branchId: id }, data: { isActive: false } }),
  ]);
  await writeAudit({
    actorId: ctx.userId,
    action: "BRANCH_DELETED",
    resource: "Branch",
    resourceId: id,
    metadata: { code: existing.code },
  });
}

// ───────────────────────── Departments ─────────────────────────

export async function listDepartments(ctx: AuthContext) {
  const scope = requirePermission(ctx, "department.view");
  return prisma.department.findMany({
    where: { deletedAt: null, ...departmentWhere(scope) },
    orderBy: [{ district: { name: "asc" } }, { name: "asc" }],
    include: { district: { select: { id: true, name: true } } },
  });
}

function departmentTarget(d: { id: string; districtId: string | null }) {
  return { type: "DEPARTMENT" as const, departmentId: d.id, districtId: d.districtId };
}

export async function createDepartment(ctx: AuthContext, input: unknown) {
  const data: DepartmentInput = parse(departmentSchema, input);
  const districtId = data.districtId ?? null;
  if (districtId) await activeDistrictOrThrow(districtId);
  // Head Office departments (no district) need bank-wide permission.
  requirePermissionOn(
    ctx,
    "department.create",
    districtId ? { type: "DISTRICT", districtId } : { type: "ALL" },
  );
  const row = await uniqueGuard(
    () => prisma.department.create({ data: { ...data, districtId } }),
    "Department",
  );
  await writeAudit({
    actorId: ctx.userId,
    action: "DEPARTMENT_CREATED",
    resource: "Department",
    resourceId: row.id,
    metadata: data,
  });
  return row;
}

export async function updateDepartment(ctx: AuthContext, id: string, input: unknown) {
  const existing = await prisma.department.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("Department");
  requirePermissionOn(ctx, "department.update", departmentTarget(existing));
  const data: DepartmentInput = parse(departmentSchema, input);
  const districtId = data.districtId ?? null;
  if (districtId !== existing.districtId) {
    if (districtId) await activeDistrictOrThrow(districtId);
    requirePermissionOn(
      ctx,
      "department.update",
      districtId ? { type: "DISTRICT", districtId } : { type: "ALL" },
    );
  }
  const row = await uniqueGuard(
    () => prisma.department.update({ where: { id }, data: { ...data, districtId } }),
    "Department",
  );
  await writeAudit({
    actorId: ctx.userId,
    action: "DEPARTMENT_UPDATED",
    resource: "Department",
    resourceId: id,
    metadata: data,
  });
  return row;
}

export async function deleteDepartment(ctx: AuthContext, id: string) {
  const existing = await prisma.department.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("Department");
  requirePermissionOn(ctx, "department.delete", departmentTarget(existing));
  await prisma.$transaction([
    prisma.department.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    prisma.qRCode.updateMany({ where: { departmentId: id }, data: { isActive: false } }),
  ]);
  await writeAudit({
    actorId: ctx.userId,
    action: "DEPARTMENT_DELETED",
    resource: "Department",
    resourceId: id,
    metadata: { code: existing.code },
  });
}
