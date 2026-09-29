"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/admin/confirm-dialog";
import { Field, FormError } from "@/components/admin/form-bits";
import { useAction } from "@/components/admin/use-action";
import { deleteRoleAction, saveRoleAction } from "@/server/actions/admin";

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

export interface PermissionGroup {
  group: string;
  permissions: { key: string; held: boolean }[];
}

export function RolesManager({
  rows,
  groups,
  canCreate,
  canUpdate,
  canDelete,
}: {
  rows: RoleRow[];
  /** `held` marks permissions the current user may grant (they hold them). Server re-checks. */
  groups: PermissionGroup[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <PlusIcon /> Add role
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Users</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium">
                    {r.name} {r.isSystem ? <Badge variant="outline">System</Badge> : null}
                  </div>
                  {r.description ? (
                    <div className="text-xs text-muted-foreground">{r.description}</div>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.key}</TableCell>
                <TableCell>{r.permissions.length}</TableCell>
                <TableCell>{r.userCount}</TableCell>
                <TableCell className="space-x-2 text-right">
                  {canUpdate ? (
                    <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                  ) : null}
                  {canDelete && !r.isSystem ? (
                    <ConfirmButton
                      label="Delete"
                      title={`Delete ${r.name}?`}
                      description="Roles assigned to users cannot be deleted."
                      confirmLabel="Delete role"
                      action={() => deleteRoleAction(r.id)}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <RoleDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          groups={groups}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function RoleDialog({
  row,
  groups,
  onClose,
}: {
  row: RoleRow | null;
  groups: PermissionGroup[];
  onClose: () => void;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set(row?.permissions ?? []));

  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row ? `Edit ${row.name}` : "Add role"}</DialogTitle>
          <DialogDescription>
            Permissions decide what a role can do. Where it applies (bank, district, branch) is set when the
            role is assigned to a user.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(
              () =>
                saveRoleAction(row?.id ?? null, {
                  ...(row ? {} : { key: f.get("key") }),
                  name: f.get("name"),
                  description: f.get("description") || null,
                  permissions: [...selected],
                }),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {row ? null : (
              <Field
                label="Key"
                htmlFor="key"
                errors={fieldErrors.key}
                hint="UPPER_SNAKE_CASE, cannot be changed later."
              >
                <Input id="key" name="key" required maxLength={40} placeholder="AUDITOR" />
              </Field>
            )}
            <Field label="Name" htmlFor="name" errors={fieldErrors.name}>
              <Input id="name" name="name" defaultValue={row?.name} required maxLength={120} />
            </Field>
          </div>
          <Field label="Description" htmlFor="description" errors={fieldErrors.description}>
            <Input
              id="description"
              name="description"
              defaultValue={row?.description ?? ""}
              maxLength={300}
            />
          </Field>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Permissions ({selected.size})</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((g) => (
                <div key={g.group} className="rounded-md border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.group}
                  </p>
                  <div className="grid gap-1.5">
                    {g.permissions.map((p) => (
                      <label
                        key={p.key}
                        className={`flex items-center gap-2 text-sm ${p.held ? "" : "opacity-50"}`}
                      >
                        <Checkbox
                          checked={selected.has(p.key)}
                          disabled={!p.held && !selected.has(p.key)}
                          onCheckedChange={(v) => toggle(p.key, v === true)}
                        />
                        {p.key.split(".")[1]}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {fieldErrors.permissions?.map((m) => (
              <p key={m} className="text-xs text-destructive">
                {m}
              </p>
            ))}
          </fieldset>
          <FormError message={Object.keys(fieldErrors).length ? null : error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
