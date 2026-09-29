"use server";

import { runAction } from "./helpers";
import * as org from "@/server/services/organization";

const revalidate = ["/admin/districts", "/admin/branches", "/admin/departments"];

export async function saveDistrictAction(id: string | null, input: unknown) {
  return runAction(
    async (ctx) => {
      const row = id ? await org.updateDistrict(ctx, id, input) : await org.createDistrict(ctx, input);
      return { id: row.id };
    },
    { revalidate, message: id ? "District updated." : "District created." },
  );
}
export async function deleteDistrictAction(id: string) {
  return runAction((ctx) => org.deleteDistrict(ctx, id), { revalidate, message: "District deleted." });
}

export async function saveBranchAction(id: string | null, input: unknown) {
  return runAction(
    async (ctx) => {
      const row = id ? await org.updateBranch(ctx, id, input) : await org.createBranch(ctx, input);
      return { id: row.id };
    },
    { revalidate, message: id ? "Branch updated." : "Branch created." },
  );
}
export async function deleteBranchAction(id: string) {
  return runAction((ctx) => org.deleteBranch(ctx, id), { revalidate, message: "Branch deleted." });
}

export async function saveDepartmentAction(id: string | null, input: unknown) {
  return runAction(
    async (ctx) => {
      const row = id ? await org.updateDepartment(ctx, id, input) : await org.createDepartment(ctx, input);
      return { id: row.id };
    },
    { revalidate, message: id ? "Department updated." : "Department created." },
  );
}
export async function deleteDepartmentAction(id: string) {
  return runAction((ctx) => org.deleteDepartment(ctx, id), { revalidate, message: "Department deleted." });
}
