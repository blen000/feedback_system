"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/admin/confirm-dialog";
import { Field, FormError, NativeSelect } from "@/components/admin/form-bits";
import { EmptyState } from "@/components/admin/page-header";
import { useAction } from "@/components/admin/use-action";
import { deleteBranchAction, saveBranchAction } from "@/server/actions/organization";

export interface BranchRow {
  id: string;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  isActive: boolean;
  districtId: string;
  districtName: string;
}

export function BranchesManager({
  rows,
  districts,
  canCreate,
  canUpdate,
  canDelete,
}: {
  rows: BranchRow[];
  districts: { id: string; name: string }[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState<BranchRow | "new" | null>(null);
  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")} disabled={districts.length === 0}>
            <PlusIcon /> Add branch
          </Button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          title="No branches"
          description="There are no branches in the locations you can access."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>District</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.districtName}</TableCell>
                  <TableCell>{r.city ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.isActive ? "secondary" : "outline"}>
                      {r.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {canUpdate ? (
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <ConfirmButton
                        label="Delete"
                        title={`Delete ${r.name}?`}
                        description="The branch and its QR codes will be deactivated. Existing feedback is kept."
                        confirmLabel="Delete branch"
                        action={() => deleteBranchAction(r.id)}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <BranchDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          districts={districts}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function BranchDialog({
  row,
  districts,
  onClose,
}: {
  row: BranchRow | null;
  districts: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? "Edit branch" : "Add branch"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(
              () =>
                saveBranchAction(row?.id ?? null, {
                  code: f.get("code"),
                  name: f.get("name"),
                  districtId: f.get("districtId"),
                  city: f.get("city") || null,
                  address: f.get("address") || null,
                  isActive: f.get("isActive") === "on",
                }),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" htmlFor="code" errors={fieldErrors.code}>
              <Input id="code" name="code" defaultValue={row?.code} required maxLength={32} />
            </Field>
            <Field label="District" htmlFor="districtId" errors={fieldErrors.districtId}>
              <NativeSelect
                id="districtId"
                name="districtId"
                defaultValue={row?.districtId ?? districts[0]?.id}
                required
              >
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Name" htmlFor="name" errors={fieldErrors.name}>
            <Input id="name" name="name" defaultValue={row?.name} required maxLength={120} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" htmlFor="city" errors={fieldErrors.city}>
              <Input id="city" name="city" defaultValue={row?.city ?? ""} maxLength={80} />
            </Field>
            <Field label="Address" htmlFor="address" errors={fieldErrors.address}>
              <Input id="address" name="address" defaultValue={row?.address ?? ""} maxLength={200} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="isActive" defaultChecked={row?.isActive ?? true} /> Active
          </label>
          <FormError message={Object.keys(fieldErrors).length ? null : error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
