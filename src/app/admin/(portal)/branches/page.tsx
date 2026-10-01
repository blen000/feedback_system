import type { Metadata } from "next";
import { BranchesManager } from "@/components/admin/org/branches-manager";
import { PageHeader } from "@/components/admin/page-header";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { listBranches, listDistricts } from "@/server/services/organization";

export const metadata: Metadata = { title: "Branches" };

export default async function BranchesPage() {
  const { ctx } = await pageAccess("branch.view");
  const branches = await listBranches(ctx);
  // District choices for the form: everything the user may view, else the districts of visible branches.
  const districts = can(ctx, "district.view")
    ? (await listDistricts(ctx)).map((d) => ({ id: d.id, name: d.name }))
    : [...new Map(branches.map((b) => [b.district.id, b.district])).values()];
  return (
    <>
      <PageHeader title="Branches" description="Every branch belongs to one district." />
      <BranchesManager
        rows={branches.map((b) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          city: b.city,
          address: b.address,
          isActive: b.isActive,
          districtId: b.districtId,
          districtName: b.district.name,
        }))}
        districts={districts}
        canCreate={can(ctx, "branch.create")}
        canUpdate={can(ctx, "branch.update")}
        canDelete={can(ctx, "branch.delete")}
      />
    </>
  );
}
