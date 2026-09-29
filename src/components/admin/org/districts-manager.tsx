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
import { Field, FormError } from "@/components/admin/form-bits";
import { EmptyState } from "@/components/admin/page-header";
import { useAction } from "@/components/admin/use-action";
import { deleteDistrictAction, saveDistrictAction } from "@/server/actions/organization";

export interface DistrictRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  branchCount: number;
}

export function DistrictsManager({
  rows,
  canCreate,
  canUpdate,
  canDelete,
}: {
  rows: DistrictRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState<DistrictRow | "new" | null>(null);
  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <PlusIcon /> Add district
          </Button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          title="No districts yet"
          description="Add a district to start building the organization."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Branches</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.branchCount}</TableCell>
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
                        description="The district and its QR codes will be deactivated. Districts that still contain branches cannot be deleted."
                        confirmLabel="Delete district"
                        action={() => deleteDistrictAction(r.id)}
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
        <DistrictDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function DistrictDialog({ row, onClose }: { row: DistrictRow | null; onClose: () => void }) {
  const { run, pending, error, fieldErrors } = useAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? "Edit district" : "Add district"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(
              () =>
                saveDistrictAction(row?.id ?? null, {
                  code: f.get("code"),
                  name: f.get("name"),
                  isActive: f.get("isActive") === "on",
                }),
              onClose,
            );
          }}
        >
          <Field label="Code" htmlFor="code" errors={fieldErrors.code}>
            <Input id="code" name="code" defaultValue={row?.code} required maxLength={32} />
          </Field>
          <Field label="Name" htmlFor="name" errors={fieldErrors.name}>
            <Input id="name" name="name" defaultValue={row?.name} required maxLength={120} />
          </Field>
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
