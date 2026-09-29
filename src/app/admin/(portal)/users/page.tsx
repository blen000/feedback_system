import type { Metadata } from "next";
import { AccessDenied, PageHeader } from "@/components/admin/page-header";
import { UsersManager } from "@/components/admin/users-manager";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { emailEnabled } from "@/lib/mail/mailer";
import { listAssignmentOptions, listUsers } from "@/server/services/users";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const { ctx, allowed } = await pageAccess("user.view");
  if (!allowed) return <AccessDenied />;

  const canManage = can(ctx, "user.create") || can(ctx, "user.update");
  const [users, options] = await Promise.all([listUsers(ctx), canManage ? listAssignmentOptions(ctx) : null]);

  return (
    <>
      <PageHeader title="Users" description="Staff accounts and the roles they hold." />
      <UsersManager
        options={options}
        canCreate={can(ctx, "user.create")}
        canUpdate={can(ctx, "user.update")}
        canDeactivate={can(ctx, "user.deactivate")}
        emailEnabled={emailEnabled()}
        rows={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          status: u.status,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          isSelf: u.id === ctx.userId,
          assignments: u.roles.map((r) => ({
            roleId: r.roleId,
            roleName: r.role.name,
            scopeType: r.scopeType,
            districtId: r.districtId,
            branchId: r.branchId,
            departmentId: r.departmentId,
            scopeLabel:
              r.scopeType === "ALL"
                ? "Entire bank"
                : (r.district?.name ?? r.branch?.name ?? r.department?.name ?? r.scopeType),
          })),
        }))}
      />
    </>
  );
}
