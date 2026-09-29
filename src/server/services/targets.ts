import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";
import type { ScopeType, Target } from "@/lib/rbac/scope";

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
