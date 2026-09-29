/**
 * Organizational scope logic. Pure functions — no database access — so the rules
 * are unit-testable. Services turn an AccessScope into Prisma `where` filters so that
 * out-of-scope rows are never fetched.
 */

export type ScopeType = "ALL" | "DISTRICT" | "BRANCH" | "DEPARTMENT";

/** A role granted to a user over a scope, with the role's permission keys resolved. */
export interface Assignment {
  roleKey: string;
  scopeType: ScopeType;
  districtId: string | null;
  branchId: string | null;
  departmentId: string | null;
  permissions: ReadonlySet<string>;
}

export interface AccessScope {
  /** true when at least one granting assignment covers the whole bank */
  all: boolean;
  districtIds: ReadonlySet<string>;
  branchIds: ReadonlySet<string>;
  departmentIds: ReadonlySet<string>;
}

export function hasAnyAccess(scope: AccessScope): boolean {
  return scope.all || scope.districtIds.size > 0 || scope.branchIds.size > 0 || scope.departmentIds.size > 0;
}

/** Union of the scopes of every assignment that grants `permission`. */
export function resolveScope(assignments: readonly Assignment[], permission: string): AccessScope {
  let all = false;
  const districtIds = new Set<string>();
  const branchIds = new Set<string>();
  const departmentIds = new Set<string>();

  for (const a of assignments) {
    if (!a.permissions.has(permission)) continue;
    switch (a.scopeType) {
      case "ALL":
        all = true;
        break;
      case "DISTRICT":
        if (a.districtId) districtIds.add(a.districtId);
        break;
      case "BRANCH":
        if (a.branchId) branchIds.add(a.branchId);
        break;
      case "DEPARTMENT":
        if (a.departmentId) departmentIds.add(a.departmentId);
        break;
    }
  }
  return { all, districtIds, branchIds, departmentIds };
}

/** A concrete organizational target, with parent ids resolved by the caller. */
export type Target =
  | { type: "ALL" }
  | { type: "DISTRICT"; districtId: string }
  | { type: "BRANCH"; branchId: string; districtId: string }
  | { type: "DEPARTMENT"; departmentId: string; districtId: string | null };

export function scopeCoversTarget(scope: AccessScope, target: Target): boolean {
  if (scope.all) return true;
  switch (target.type) {
    case "ALL":
      return false;
    case "DISTRICT":
      return scope.districtIds.has(target.districtId);
    case "BRANCH":
      return scope.branchIds.has(target.branchId) || scope.districtIds.has(target.districtId);
    case "DEPARTMENT":
      return (
        scope.departmentIds.has(target.departmentId) ||
        (target.districtId !== null && scope.districtIds.has(target.districtId))
      );
  }
}

// ── Prisma where-clause builders (evaluated in the database) ──

type Where = Record<string, unknown>;
const NOTHING: Where = { id: { in: [] as string[] } };

export function districtWhere(scope: AccessScope): Where {
  if (scope.all) return {};
  return scope.districtIds.size ? { id: { in: [...scope.districtIds] } } : NOTHING;
}

export function branchWhere(scope: AccessScope): Where {
  if (scope.all) return {};
  const or: Where[] = [];
  if (scope.districtIds.size) or.push({ districtId: { in: [...scope.districtIds] } });
  if (scope.branchIds.size) or.push({ id: { in: [...scope.branchIds] } });
  return or.length ? { OR: or } : NOTHING;
}

export function departmentWhere(scope: AccessScope): Where {
  if (scope.all) return {};
  const or: Where[] = [];
  if (scope.districtIds.size) or.push({ districtId: { in: [...scope.districtIds] } });
  if (scope.departmentIds.size) or.push({ id: { in: [...scope.departmentIds] } });
  return or.length ? { OR: or } : NOTHING;
}

/**
 * Filter for rows carrying denormalized districtId/branchId/departmentId
 * (feedback submissions, QR codes). Column names are identical on those models.
 */
export function locationWhere(scope: AccessScope): Where {
  if (scope.all) return {};
  const or: Where[] = [];
  if (scope.districtIds.size) or.push({ districtId: { in: [...scope.districtIds] } });
  if (scope.branchIds.size) or.push({ branchId: { in: [...scope.branchIds] } });
  if (scope.departmentIds.size) or.push({ departmentId: { in: [...scope.departmentIds] } });
  return or.length ? { OR: or } : NOTHING;
}

/**
 * Filter for QR codes. A QR stores exactly one location column, so a district-scoped user
 * must also match QR codes whose branch/department belongs to their district.
 */
export function qrWhere(scope: AccessScope): Where {
  if (scope.all) return {};
  const d = [...scope.districtIds];
  const or: Where[] = [];
  if (d.length) {
    or.push(
      { districtId: { in: d } },
      { branch: { districtId: { in: d } } },
      { department: { districtId: { in: d } } },
    );
  }
  if (scope.branchIds.size) or.push({ branchId: { in: [...scope.branchIds] } });
  if (scope.departmentIds.size) or.push({ departmentId: { in: [...scope.departmentIds] } });
  return or.length ? { OR: or } : NOTHING;
}
