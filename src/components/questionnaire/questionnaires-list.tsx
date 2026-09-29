"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormError } from "@/components/admin/form-bits";
import { EmptyState } from "@/components/admin/page-header";
import { useAction } from "@/components/admin/use-action";
import { LocalizedInput } from "./localized-input";
import { createQuestionnaireAction } from "@/server/actions/questionnaires";
import { SUPPORTED_LOCALES, type Localized } from "@/lib/questionnaire/types";

export interface QuestionnaireListRow {
  id: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ACTIVE" | "PAUSED" | "CLOSED";
  questionCount: number;
  assignmentCount: number;
  latestVersion: number;
  updatedAt: string;
}

export const STATUS_STYLE: Record<QuestionnaireListRow["status"], string> = {
  DRAFT: "bg-muted text-foreground",
  PUBLISHED: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  ACTIVE: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  PAUSED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  CLOSED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function StatusBadge({ status }: { status: QuestionnaireListRow["status"] }) {
  return <Badge className={STATUS_STYLE[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

export function QuestionnairesList({
  rows,
  canCreate,
}: {
  rows: QuestionnaireListRow[];
  canCreate: boolean;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> New questionnaire
          </Button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          title="No questionnaires yet"
          description="Create one, add questions from the library, then publish it."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Questions</TableHead>
                <TableHead>Locations</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>{r.questionCount}</TableCell>
                  <TableCell>{r.assignmentCount}</TableCell>
                  <TableCell>{r.latestVersion ? `v${r.latestVersion}` : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/admin/questionnaires/${r.id}`} />}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {creating ? <CreateDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { run, pending, error, fieldErrors } = useAction();
  const [title, setTitle] = useState<Localized>({});
  const [description, setDescription] = useState<Localized>({});
  const [locales, setLocales] = useState<string[]>(["en"]);
  const [collectContact, setCollectContact] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New questionnaire</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                createQuestionnaireAction({
                  title,
                  description,
                  defaultLocale: "en",
                  locales,
                  collectContact,
                }),
              (data) => {
                onClose();
                if (data && typeof data === "object" && "id" in data)
                  router.push(`/admin/questionnaires/${data.id}`);
              },
            );
          }}
        >
          <LocalizedInput
            id="title"
            label="Title"
            required
            value={title}
            onChange={setTitle}
            errors={fieldErrors.title}
            enabledLocales={locales}
            maxLength={150}
          />
          <LocalizedInput
            id="description"
            label="Description (optional)"
            multiline
            value={description}
            onChange={setDescription}
            enabledLocales={locales}
            maxLength={500}
          />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Languages offered to customers</legend>
            {SUPPORTED_LOCALES.map((l) => (
              <label key={l.code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={locales.includes(l.code)}
                  disabled={l.code === "en"}
                  onCheckedChange={(v) =>
                    setLocales((cur) => (v === true ? [...cur, l.code] : cur.filter((x) => x !== l.code)))
                  }
                />
                {l.name}
                {l.code === "en" ? " (default, required)" : ""}
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={collectContact}
              onCheckedChange={(v) => setCollectContact(v === true)}
            />
            <span>
              Offer follow-up contact
              <span className="block text-xs text-muted-foreground">
                Customers may optionally leave a phone number. Feedback is anonymous otherwise.
              </span>
            </span>
          </label>
          <FormError message={Object.keys(fieldErrors).length ? null : error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
