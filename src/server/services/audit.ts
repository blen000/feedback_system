import { prisma } from "@/lib/db/prisma";
import { requirePermission, type AuthContext } from "@/lib/rbac/authorize";

export async function listAuditLogs(
  ctx: AuthContext,
  opts: { page?: number; pageSize?: number; action?: string } = {},
) {
  requirePermission(ctx, "audit.view");
  const pageSize = Math.min(opts.pageSize ?? 50, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const where = opts.action ? { action: opts.action } : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}
