import { prisma } from "@/lib/db/prisma";
import { can, requirePermission, type AuthContext } from "@/lib/rbac/authorize";
import { branchWhere, departmentWhere, districtWhere } from "@/lib/rbac/scope";

/** Organization counts limited to what the actor may view, plus a readable summary of their access. */
export async function getAccessSummary(ctx: AuthContext) {
  requirePermission(ctx, "dashboard.view");

  const [districts, branches, departments] = await Promise.all([
    can(ctx, "district.view")
      ? prisma.district.count({
          where: { deletedAt: null, ...districtWhere(requirePermission(ctx, "district.view")) },
        })
      : null,
    can(ctx, "branch.view")
      ? prisma.branch.count({
          where: { deletedAt: null, ...branchWhere(requirePermission(ctx, "branch.view")) },
        })
      : null,
    can(ctx, "department.view")
      ? prisma.department.count({
          where: { deletedAt: null, ...departmentWhere(requirePermission(ctx, "department.view")) },
        })
      : null,
  ]);

  const roleKeys = [...new Set(ctx.assignments.map((a) => a.roleKey))];
  const roles = await prisma.role.findMany({
    where: { key: { in: roleKeys } },
    select: { key: true, name: true },
  });
  const nameOf = new Map(roles.map((r) => [r.key, r.name]));

  const [districtNames, branchNames] = await Promise.all([
    prisma.district.findMany({
      where: { id: { in: ctx.assignments.flatMap((a) => (a.districtId ? [a.districtId] : [])) } },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { id: { in: ctx.assignments.flatMap((a) => (a.branchId ? [a.branchId] : [])) } },
      select: { id: true, name: true },
    }),
  ]);
  const dn = new Map(districtNames.map((d) => [d.id, d.name]));
  const bn = new Map(branchNames.map((b) => [b.id, b.name]));

  const access = ctx.assignments.map((a) => ({
    role: nameOf.get(a.roleKey) ?? a.roleKey,
    scope:
      a.scopeType === "ALL"
        ? "Entire bank"
        : a.scopeType === "DISTRICT"
          ? `District: ${dn.get(a.districtId!) ?? "—"}`
          : a.scopeType === "BRANCH"
            ? `Branch: ${bn.get(a.branchId!) ?? "—"}`
            : "Department",
  }));

  return { counts: { districts, branches, departments }, access };
}
