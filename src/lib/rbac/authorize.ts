/**
 * Authorization primitives used by every service. The chain is:
 * authenticated user → active account → assignments → permission → scope → action.
 * (Authentication and account status are checked when the AuthContext is built.)
 */
import { forbidden } from "@/lib/errors";
import {
  hasAnyAccess,
  resolveScope,
  scopeCoversTarget,
  type AccessScope,
  type Assignment,
  type Target,
} from "./scope";
import type { PermissionKey } from "./permissions";

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  assignments: readonly Assignment[];
}

/** True when any assignment grants the permission (regardless of scope). */
export function can(ctx: AuthContext, permission: PermissionKey): boolean {
  return hasAnyAccess(resolveScope(ctx.assignments, permission));
}

/** Throws FORBIDDEN unless granted; returns the scope over which it is granted. */
export function requirePermission(ctx: AuthContext, permission: PermissionKey): AccessScope {
  const scope = resolveScope(ctx.assignments, permission);
  if (!hasAnyAccess(scope)) throw forbidden();
  return scope;
}

/** Throws FORBIDDEN unless `permission` is granted over the specific target. */
export function requirePermissionOn(ctx: AuthContext, permission: PermissionKey, target: Target): void {
  const scope = requirePermission(ctx, permission);
  if (!scopeCoversTarget(scope, target)) throw forbidden();
}

/**
 * Anti privilege-escalation: an actor may only grant/manage a role assignment if, for every
 * permission in that role, the actor holds that permission over the assignment's target.
 */
export function actorCoversRole(
  ctx: AuthContext,
  rolePermissions: Iterable<string>,
  target: Target,
): boolean {
  for (const p of rolePermissions) {
    if (!scopeCoversTarget(resolveScope(ctx.assignments, p), target)) return false;
  }
  return true;
}

/** Actor holds every listed permission (in any scope). Used for editing roles. */
export function actorHoldsAll(ctx: AuthContext, permissions: Iterable<string>): boolean {
  for (const p of permissions) {
    if (!hasAnyAccess(resolveScope(ctx.assignments, p))) return false;
  }
  return true;
}
