import type { Metadata } from "next";
import { DepartmentsManager } from "@/components/admin/org/departments-manager";
import { PageHeader } from "@/components/admin/page-header";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { listDepartments, listDistricts } from "@/server/services/organization";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const { ctx } = await pageAccess("department.view");
  const departments = await listDepartments(ctx);
  const districts = can(ctx, "district.view")
    ? (await listDistricts(ctx)).map((d) => ({ id: d.id, name: d.name }))
    : [
        ...new Map(
          departments.flatMap((d) => (d.district ? [[d.district.id, d.district] as const] : [])),
        ).values(),
      ];
  return (
    <>
      <PageHeader title="Departments" description="Head Office departments and district-level departments." />
      <DepartmentsManager
        rows={departments.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          isActive: d.isActive,
          districtId: d.districtId,
          districtName: d.district?.name ?? null,
        }))}
        districts={districts}
        canCreate={can(ctx, "department.create")}
        canUpdate={can(ctx, "department.update")}
        canDelete={can(ctx, "department.delete")}
      />
    </>
  );
}
