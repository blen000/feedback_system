import type { Metadata } from "next";
import { DistrictsManager } from "@/components/admin/org/districts-manager";
import { AccessDenied, PageHeader } from "@/components/admin/page-header";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { listDistricts } from "@/server/services/organization";

export const metadata: Metadata = { title: "Districts" };

export default async function DistrictsPage() {
  const { ctx, allowed } = await pageAccess("district.view");
  if (!allowed) return <AccessDenied />;
  const districts = await listDistricts(ctx);
  return (
    <>
      <PageHeader title="Districts" description="Regional groupings of branches." />
      <DistrictsManager
        rows={districts.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          isActive: d.isActive,
          branchCount: d._count.branches,
        }))}
        canCreate={can(ctx, "district.create")}
        canUpdate={can(ctx, "district.update")}
        canDelete={can(ctx, "district.delete")}
      />
    </>
  );
}
