import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { RolesManager } from "@/components/admin/roles-manager";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import type { PermissionKey } from "@/lib/rbac/permissions";
import { listPermissions, listRoles } from "@/server/services/roles";

export const metadata: Metadata = { title: "Roles" };

export default async function RolesPage() {
  const { ctx } = await pageAccess("role.view");
  const [roles, permissions] = await Promise.all([listRoles(ctx), listPermissions(ctx)]);

  const byGroup = new Map<string, { key: string; held: boolean }[]>();
  for (const p of permissions) {
    const list = byGroup.get(p.group) ?? [];
    list.push({ key: p.key, held: can(ctx, p.key as PermissionKey) });
    byGroup.set(p.group, list);
  }

  return (
    <>
      <PageHeader
        title="Roles"
        description="Roles are collections of permissions. You can only grant permissions you hold yourself."
      />
      <RolesManager
        rows={roles}
        groups={[...byGroup].map(([group, permissions]) => ({ group, permissions }))}
        canCreate={can(ctx, "role.create")}
        canUpdate={can(ctx, "role.update")}
        canDelete={can(ctx, "role.delete")}
      />
    </>
  );
}
