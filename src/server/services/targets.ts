import { prisma } from "@/lib/db/prisma";
import { invalid, notFound } from "@/lib/errors";
import {
  branchWhere,
  departmentWhere,
  districtWhere,
  type AccessScope,
  type ScopeType,
  type Target,
} from "@/lib/rbac/scope";

export interface TargetRef {
  scopeType: ScopeType;
  districtId?: string | null;
  branchId?: string | null;
  departmentId?: string | null;
}

/** Resolves a scope reference to a concrete Target (with parent ids), verifying it exists. */
export async function resolveTarget(a: TargetRef): Promise<Target> {
  switch (a.scopeType) {
    case "ALL":
      return { type: "ALL" };
    case "DISTRICT": {
      const d = await prisma.district.findFirst({ where: { id: a.districtId ?? "", deletedAt: null } });
      if (!d) throw notFound("District");
      return { type: "DISTRICT", districtId: d.id };
    }
    case "BRANCH": {
      const b = await prisma.branch.findFirst({ where: { id: a.branchId ?? "", deletedAt: null } });
      if (!b) throw notFound("Branch");
      return { type: "BRANCH", branchId: b.id, districtId: b.districtId };
    }
    case "DEPARTMENT": {
      const d = await prisma.department.findFirst({ where: { id: a.departmentId ?? "", deletedAt: null } });
      if (!d) throw notFound("Department");
      return { type: "DEPARTMENT", departmentId: d.id, districtId: d.districtId };
    }
  }
}

export type LocationKind = "DISTRICT" | "BRANCH" | "DEPARTMENT";

/**
 * Every live location of `kind` inside `scope` — what "All districts/branches/departments" means
 * for that actor. Bank-wide actors get every one; scoped actors only their own reach.
 */
export async function expandAllLocations(
  kind: LocationKind,
  scope: AccessScope,
  opts: { activeOnly?: boolean } = {},
): Promise<string[]> {
  const base = { deletedAt: null, ...(opts.activeOnly ? { isActive: true } : {}) };
  const select = { id: true } as const;
  const orderBy = { name: "asc" } as const;
  const rows =
    kind === "DISTRICT"
      ? await prisma.district.findMany({ where: { ...base, ...districtWhere(scope) }, select, orderBy })
      : kind === "BRANCH"
        ? await prisma.branch.findMany({ where: { ...base, ...branchWhere(scope) }, select, orderBy })
        : await prisma.department.findMany({
            where: { ...base, ...departmentWhere(scope) },
            select,
            orderBy,
          });
  if (rows.length === 0) {
    const noun = { DISTRICT: "districts", BRANCH: "branches", DEPARTMENT: "departments" }[kind];
    throw invalid(`There are no ${noun} available to apply this to.`);
  }
  return rows.map((r) => r.id);
}
