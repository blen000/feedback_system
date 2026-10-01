"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Field, FormError, NativeSelect } from "@/components/admin/form-bits";
import { EmptyState } from "@/components/admin/page-header";
import { useAction } from "@/components/admin/use-action";
import {
  createUserAction,
  resendInviteAction,
  resetPasswordAction,
  setUserActiveAction,
  updateUserAction,
} from "@/server/actions/admin";

type ScopeType = "ALL" | "DISTRICT" | "BRANCH" | "DEPARTMENT";
interface Assignment {
  roleId: string;
  scopeType: ScopeType;
  districtId: string | null;
  branchId: string | null;
  departmentId: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  lastLoginAt: string | null;
  isSelf: boolean;
  assignments: (Assignment & { roleName: string; scopeLabel: string })[];
}

export interface Options {
  roles: { id: string; name: string }[];
  districts: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  canAssignAll: boolean;
}

export function UsersManager({
  rows,
  options,
  canCreate,
  canUpdate,
  canDeactivate,
  emailEnabled,
}: {
  rows: UserRow[];
  options: Options | null;
  canCreate: boolean;
  canUpdate: boolean;
  canDeactivate: boolean;
  /** true when the system can send email: new users receive an invitation link instead of an admin-set password */
  emailEnabled: boolean;
}) {
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [tempPassword, setTempPassword] = useState<{
    email: string;
    password: string;
    hours: number | null;
  } | null>(null);
  const reset = useAction();

  return (
    <div className="space-y-4">
      {canCreate && options ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <PlusIcon /> Add user
          </Button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="No users" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.assignments.map((a, i) => (
                        <Badge key={i} variant="secondary">
                          {a.roleName} · {a.scopeLabel}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "ACTIVE" ? "secondary" : "outline"}>
                      {u.status === "ACTIVE" ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell className="space-x-2 whitespace-nowrap text-right">
                    {canUpdate && options && !u.isSelf ? (
                      <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                        Edit
                      </Button>
                    ) : null}
                    {emailEnabled && canUpdate && !u.isSelf && u.status === "ACTIVE" && !u.lastLoginAt ? (
                      <ConfirmButton
                        label="Resend invite"
                        variant="outline"
                        title={`Resend the invitation to ${u.email}?`}
                        description="They will receive a new link to choose their password. Any earlier invitation stops working."
                        confirmLabel="Send invitation"
                        action={() => resendInviteAction(u.id)}
                      />
                    ) : null}
                    {canUpdate && !u.isSelf ? (
                      <ResetPasswordButton
                        user={u}
                        emailEnabled={emailEnabled}
                        onTemporaryPassword={(password, hours) =>
                          setTempPassword({ email: u.email, password, hours })
                        }
                      />
                    ) : null}
                    {canDeactivate && !u.isSelf ? (
                      u.status === "ACTIVE" ? (
                        <ConfirmButton
                          label="Deactivate"
                          title={`Deactivate ${u.name}?`}
                          description="They will be signed out immediately and unable to sign in until reactivated."
                          confirmLabel="Deactivate"
                          action={() => setUserActiveAction(u.id, false)}
                        />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reset.pending}
                          onClick={() => reset.run(() => setUserActiveAction(u.id, true))}
                        >
                          Activate
                        </Button>
                      )
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && options ? (
        <UserDialog
          emailEnabled={emailEnabled}
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <Dialog open={!!tempPassword} onOpenChange={(o) => !o && setTempPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
            <DialogDescription>
              Give this to {tempPassword?.email} through a secure channel. It is shown only once, must be
              changed at first sign-in
              {tempPassword?.hours ? ` and stops working after ${tempPassword.hours} hours` : ""}.
            </DialogDescription>
          </DialogHeader>
          <code className="select-all rounded-md bg-muted px-3 py-2 text-center font-mono text-lg">
            {tempPassword?.password}
          </code>
          <DialogFooter>
            <Button onClick={() => setTempPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Password reset is sensitive: the administrator re-enters their own password to confirm it. */
function ResetPasswordButton({
  user,
  emailEnabled,
  onTemporaryPassword,
}: {
  user: UserRow;
  emailEnabled: boolean;
  onTemporaryPassword: (password: string, hours: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending, error, fieldErrors, reset } = useAction();
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Reset password
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const currentPassword = String(new FormData(e.currentTarget).get("currentPassword") ?? "");
              run(
                () => resetPasswordAction(user.id, { currentPassword }),
                (data) => {
                  setOpen(false);
                  if (data?.temporaryPassword)
                    onTemporaryPassword(data.temporaryPassword, data.validForHours);
                  else toast.success(`A password reset link was emailed to ${user.email}.`);
                },
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>Reset password for {user.name}?</DialogTitle>
              <DialogDescription>
                {emailEnabled
                  ? "Their current password stops working, all of their sessions end, and they receive an email with a one-time link to choose a new one."
                  : "A temporary password will be generated, valid for a limited time. All of their sessions end and they must choose a new password at next sign-in."}{" "}
                Confirm with your own password. Security contacts are notified of this action.
              </DialogDescription>
            </DialogHeader>
            <Field label="Your password" htmlFor="currentPassword" errors={fieldErrors.currentPassword}>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
            {error && !fieldErrors.currentPassword ? <FormError message={error} /> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Working…" : "Reset password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const blank = (o: Options): Assignment => ({
  roleId: o.roles[0]?.id ?? "",
  scopeType: o.canAssignAll ? "ALL" : o.districts.length ? "DISTRICT" : "BRANCH",
  districtId: null,
  branchId: null,
  departmentId: null,
});

function UserDialog({
  row,
  options,
  emailEnabled,
  onClose,
}: {
  row: UserRow | null;
  options: Options;
  emailEnabled: boolean;
  onClose: () => void;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  const [items, setItems] = useState<Assignment[]>(
    row
      ? row.assignments.map(({ roleId, scopeType, districtId, branchId, departmentId }) => ({
          roleId,
          scopeType,
          districtId,
          branchId,
          departmentId,
        }))
      : [blank(options)],
  );

  function patch(i: number, next: Partial<Assignment>) {
    setItems((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...next } : a)));
  }
  function setScope(i: number, scopeType: ScopeType) {
    const first = {
      DISTRICT: options.districts[0]?.id,
      BRANCH: options.branches[0]?.id,
      DEPARTMENT: options.departments[0]?.id,
      ALL: undefined,
    }[scopeType];
    patch(i, {
      scopeType,
      districtId: scopeType === "DISTRICT" ? (first ?? null) : null,
      branchId: scopeType === "BRANCH" ? (first ?? null) : null,
      departmentId: scopeType === "DEPARTMENT" ? (first ?? null) : null,
    });
  }

  const assignmentErrors = Object.entries(fieldErrors)
    .filter(([k]) => k.startsWith("assignments"))
    .flatMap(([, v]) => v);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{row ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>
            Each role applies to the location you choose. Users only ever see data inside it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (row) {
              run(() => updateUserAction(row.id, { name: f.get("name"), assignments: items }), onClose);
              return;
            }
            run(
              () =>
                createUserAction({
                  email: f.get("email"),
                  name: f.get("name"),
                  password: emailEnabled ? undefined : f.get("password"),
                  assignments: items,
                }),
              (res) => {
                if (res?.inviteMode && res.emailSent)
                  toast.success("User created. An invitation email was sent.");
                else if (res?.inviteMode)
                  toast.warning(
                    "User created, but the invitation email could not be sent. Use “Resend invite”.",
                  );
                else toast.success("User created. They must change the password at first sign-in.");
                onClose();
              },
            );
          }}
        >
          {row ? null : (
            <Field label="Email" htmlFor="email" errors={fieldErrors.email}>
              <Input id="email" name="email" type="email" required autoComplete="off" />
            </Field>
          )}
          <Field label="Full name" htmlFor="name" errors={fieldErrors.name}>
            <Input id="name" name="name" defaultValue={row?.name} required maxLength={120} />
          </Field>
          {row ? null : emailEnabled ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              An email with a link to choose a password will be sent to this address. You will not see or set
              the password.
            </p>
          ) : (
            <Field
              label="Temporary password"
              htmlFor="password"
              errors={fieldErrors.password}
              hint="At least 10 characters with upper- and lower-case letters, a number and a special character. The user must change it at first sign-in."
            >
              <Input id="password" name="password" type="text" required autoComplete="off" />
            </Field>
          )}

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Roles & scope</legend>
            {items.map((a, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]">
                <NativeSelect
                  aria-label="Role"
                  value={a.roleId}
                  onChange={(e) => patch(i, { roleId: e.target.value })}
                >
                  {options.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
                <div className="grid gap-2">
                  <NativeSelect
                    aria-label="Scope"
                    value={a.scopeType}
                    onChange={(e) => setScope(i, e.target.value as ScopeType)}
                  >
                    {options.canAssignAll ? <option value="ALL">Entire bank</option> : null}
                    {options.districts.length ? <option value="DISTRICT">District</option> : null}
                    {options.branches.length ? <option value="BRANCH">Branch</option> : null}
                    {options.departments.length ? <option value="DEPARTMENT">Department</option> : null}
                  </NativeSelect>
                  {a.scopeType === "DISTRICT" ? (
                    <NativeSelect
                      aria-label="District"
                      value={a.districtId ?? ""}
                      onChange={(e) => patch(i, { districtId: e.target.value })}
                    >
                      {options.districts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                  {a.scopeType === "BRANCH" ? (
                    <NativeSelect
                      aria-label="Branch"
                      value={a.branchId ?? ""}
                      onChange={(e) => patch(i, { branchId: e.target.value })}
                    >
                      {options.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                  {a.scopeType === "DEPARTMENT" ? (
                    <NativeSelect
                      aria-label="Department"
                      value={a.departmentId ?? ""}
                      onChange={(e) => patch(i, { departmentId: e.target.value })}
                    >
                      {options.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove role"
                  disabled={items.length === 1}
                  onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setItems((p) => [...p, blank(options)])}
            >
              <PlusIcon /> Add another role
            </Button>
            {assignmentErrors.map((m, i) => (
              <p key={i} role="alert" className="text-xs text-destructive">
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
              {pending ? "Saving…" : "Save user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
