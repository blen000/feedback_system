/**
 * In-app notifications for staff whose role (and scope) covers a location. Email/SMS channels
 * can be added later by writing rows with another `channel` and a delivery worker; no provider is needed now.
 */
import { prisma } from "@/lib/db/prisma";
import type { AuthContext } from "@/lib/rbac/authorize";
import type { Prisma } from "@/generated/prisma/client";

export interface LocationIds {
  districtId?: string | null;
  branchId?: string | null;
  departmentId?: string | null;
}

/** Users holding `permission` whose assignment scope covers the location. Deduplicated. */
export async function usersCovering(permission: string, loc: LocationIds): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: {
      user: { status: "ACTIVE", deletedAt: null },
      role: { deletedAt: null, permissions: { some: { permission: { key: permission } } } },
    },
    select: { userId: true, scopeType: true, districtId: true, branchId: true, departmentId: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    const covers =
      r.scopeType === "ALL" ||
      (r.scopeType === "DISTRICT" && !!loc.districtId && r.districtId === loc.districtId) ||
      (r.scopeType === "BRANCH" && !!loc.branchId && r.branchId === loc.branchId) ||
      (r.scopeType === "DEPARTMENT" && !!loc.departmentId && r.departmentId === loc.departmentId);
    if (covers) ids.add(r.userId);
  }
  return [...ids];
}

export async function notifyCovering(input: {
  permission: string;
  location: LocationIds;
  type: string;
  title: string;
  body?: string;
  data?: Prisma.InputJsonValue;
}): Promise<number> {
  const userIds = await usersCovering(input.permission, input.location);
  if (userIds.length === 0) return 0;
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: input.data,
    })),
  });
  return userIds.length;
}

export async function listMyNotifications(ctx: AuthContext, limit = 10) {
  // A user may always read their own notifications; content is already scoped at creation time.
  return prisma.notification.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function unreadCount(ctx: AuthContext) {
  return prisma.notification.count({ where: { userId: ctx.userId, readAt: null } });
}

export async function markAllRead(ctx: AuthContext) {
  await prisma.notification.updateMany({
    where: { userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  });
}
