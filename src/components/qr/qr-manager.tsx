"use client";

import { useState } from "react";
import { CopyIcon, DownloadIcon, PlusIcon, PrinterIcon } from "lucide-react";
import { toast } from "sonner";
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
import { Field, FormError, NativeSelect } from "@/components/admin/form-bits";
import { EmptyState } from "@/components/admin/page-header";
import { useAction } from "@/components/admin/use-action";
import { createQrAction, deleteQrAction, regenerateQrAction, updateQrAction } from "@/server/actions/qr";

export interface QrRow {
  id: string;
  label: string;
  publicCode: string;
  url: string;
  svg: string;
  isActive: boolean;
  location: { type: string; name: string; parent: string | null; usable: boolean };
  questionnaire: string | null;
  scanCount: number;
  feedbackCount: number;
  completionRate: number | null;
  averageRating: number | null;
}

interface Locations {
  districts: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}

export function QrManager({
  rows,
  locations,
  perms,
}: {
  rows: QrRow[];
  locations: Locations | null;
  perms: { create: boolean; update: boolean; delete: boolean };
}) {
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<QrRow | null>(null);
  const [editing, setEditing] = useState<QrRow | null>(null);

  return (
    <div className="space-y-4">
      {perms.create && locations ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> New QR code
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No QR codes yet"
          description="Create a QR code for a branch, district or department, print it, and customers can leave feedback in under a minute."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>QR</TableHead>
                <TableHead>Label / location</TableHead>
                <TableHead>Active questionnaire</TableHead>
                <TableHead className="text-right">Scans</TableHead>
                <TableHead className="text-right">Feedback</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead className="text-right">Avg. rating</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setViewing(r)}
                      aria-label={`View QR code ${r.label}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.svg} alt="" width={56} height={56} className="rounded border bg-white" />
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{r.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.location.type}: {r.location.name}
                      {r.location.parent ? ` · ${r.location.parent}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.questionnaire ?? <span className="text-muted-foreground">None active</span>}
                  </TableCell>
                  <TableCell className="text-right">{r.scanCount.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{r.feedbackCount.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {r.completionRate === null ? "—" : `${(r.completionRate * 100).toFixed(1)}%`}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.averageRating === null ? "—" : r.averageRating.toFixed(1)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.isActive && r.location.usable ? "secondary" : "outline"}>
                      {!r.isActive ? "Inactive" : !r.location.usable ? "Location inactive" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2 whitespace-nowrap text-right">
                    <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
                      View
                    </Button>
                    {perms.update ? (
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Scans count page opens (repeat opens from one device within 5 minutes count once). They are not unique
        customers, so completion is an approximation.
      </p>

      {creating && locations ? (
        <CreateDialog locations={locations} onClose={() => setCreating(false)} />
      ) : null}
      {viewing ? <ViewDialog row={viewing} onClose={() => setViewing(null)} /> : null}
      {editing ? (
        <EditDialog row={editing} canDelete={perms.delete} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function ViewDialog({ row, onClose }: { row: QrRow; onClose: () => void }) {
  const base = `/admin/qr-codes/${row.id}/download`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row.label}</DialogTitle>
          <DialogDescription>
            {row.location.type}: {row.location.name}
            {row.location.parent ? ` · ${row.location.parent}` : ""}
          </DialogDescription>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={row.svg}
          alt={`QR code for ${row.label}`}
          className="mx-auto w-64 max-w-full rounded border bg-white"
        />
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
          <code className="min-w-0 flex-1 break-all text-xs">{row.url}</code>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Copy link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(row.url);
                toast.success("Link copied.");
              } catch {
                toast.error("Could not copy. Select the link and copy it manually.");
              }
            }}
          >
            <CopyIcon />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {row.questionnaire
            ? `Currently shows: ${row.questionnaire}`
            : "No questionnaire is active at this location, so customers will see a “currently closed” message."}
        </p>
        <DialogFooter className="sm:justify-start">
          <Button variant="outline" render={<a href={`${base}?format=png`} download />}>
            <DownloadIcon /> PNG
          </Button>
          <Button variant="outline" render={<a href={`${base}?format=svg`} download />}>
            <DownloadIcon /> SVG
          </Button>
          <Button
            variant="outline"
            render={<a href={`/admin/qr-print/${row.id}`} target="_blank" rel="noopener" />}
          >
            <PrinterIcon /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ locations, onClose }: { locations: Locations; onClose: () => void }) {
  const { run, pending, error, fieldErrors } = useAction();
  const kinds = [
    { type: "BRANCH" as const, label: "Branch", list: locations.branches },
    { type: "DISTRICT" as const, label: "District", list: locations.districts },
    { type: "DEPARTMENT" as const, label: "Department", list: locations.departments },
  ].filter((k) => k.list.length > 0);
  const [kind, setKind] = useState(kinds[0]?.type ?? "BRANCH");
  const list = kinds.find((k) => k.type === kind)?.list ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New QR code</DialogTitle>
          <DialogDescription>
            The code identifies a location. Customers get whichever questionnaire is active there, so you
            never need to reprint it when forms change.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(
              () =>
                createQrAction({ label: f.get("label"), scopeType: kind, locationId: f.get("locationId") }),
              onClose,
            );
          }}
        >
          <Field
            label="Label"
            htmlFor="label"
            errors={fieldErrors.label}
            hint="For example: Bole Branch – main entrance"
          >
            <Input id="label" name="label" required maxLength={120} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Location type" htmlFor="kind">
              <NativeSelect id="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                {kinds.map((k) => (
                  <option key={k.type} value={k.type}>
                    {k.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Location" htmlFor="locationId" errors={fieldErrors.locationId}>
              <NativeSelect id="locationId" name="locationId" key={kind} required>
                {list.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <FormError message={Object.keys(fieldErrors).length ? null : error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create QR code"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ row, canDelete, onClose }: { row: QrRow; canDelete: boolean; onClose: () => void }) {
  const { run, pending, error, fieldErrors } = useAction();
  const [active, setActive] = useState(row.isActive);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit QR code</DialogTitle>
          <DialogDescription>
            {row.location.type}: {row.location.name}. The location cannot be changed; create a new QR code
            instead.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(() => updateQrAction(row.id, { label: f.get("label"), isActive: active }), onClose);
          }}
        >
          <Field label="Label" htmlFor="label" errors={fieldErrors.label}>
            <Input id="label" name="label" defaultValue={row.label} required maxLength={120} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={active} onCheckedChange={(v) => setActive(v === true)} />
            <span>
              Active
              <span className="block text-xs text-muted-foreground">
                Inactive QR codes show “This feedback link is no longer available.”
              </span>
            </span>
          </label>
          <FormError message={Object.keys(fieldErrors).length ? null : error} />
          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              <ConfirmButton
                label="Regenerate code"
                variant="outline"
                title="Issue a new code?"
                description="The current public link stops working immediately, so any printed QR codes must be replaced. Use this if the code was misused."
                confirmLabel="Regenerate"
                action={async () => {
                  const r = await regenerateQrAction(row.id);
                  if (r.ok) onClose();
                  return r;
                }}
              />
              {canDelete ? (
                <ConfirmButton
                  label="Delete"
                  title="Delete this QR code?"
                  description="The public link stops working. Collected feedback is kept."
                  confirmLabel="Delete"
                  action={async () => {
                    const r = await deleteQrAction(row.id);
                    if (r.ok) onClose();
                    return r;
                  }}
                />
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
