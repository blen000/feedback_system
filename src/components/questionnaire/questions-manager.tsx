"use client";

import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
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
import { LocalizedInput } from "./localized-input";
import { deleteQuestionAction, saveQuestionAction } from "@/server/actions/questionnaires";
import {
  CHOICE_TYPES,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  pick,
  type Localized,
  type QuestionConfig,
  type QuestionType,
} from "@/lib/questionnaire/types";
import type { LibraryQuestion } from "@/server/services/questions";

export function QuestionsManager({
  rows,
  canCreate,
  canUpdate,
  canDelete,
}: {
  rows: LibraryQuestion[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState<LibraryQuestion | "new" | null>(null);
  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <PlusIcon /> Add question
          </Button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          title="The library is empty"
          description="Add reusable questions, then pick them in any questionnaire."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Used in</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="max-w-md font-medium">{pick(q.text, "en")}</TableCell>
                  <TableCell>{QUESTION_TYPE_LABELS[q.type]}</TableCell>
                  <TableCell>
                    {q.usageCount} questionnaire{q.usageCount === 1 ? "" : "s"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={q.isActive ? "secondary" : "outline"}>
                      {q.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2 whitespace-nowrap text-right">
                    {canUpdate ? (
                      <Button size="sm" variant="outline" onClick={() => setEditing(q)}>
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <ConfirmButton
                        label="Delete"
                        title="Delete this question?"
                        description="Questions used by a questionnaire cannot be deleted. Deactivate them instead."
                        confirmLabel="Delete question"
                        action={() => deleteQuestionAction(q.id)}
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
        <QuestionDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

interface OptionDraft {
  value?: string;
  label: Localized;
}

const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

/** Create or edit a library question. `onSaved` receives the newly created question (not on edit). */
export function QuestionDialog({
  row,
  onClose,
  onSaved,
}: {
  row: LibraryQuestion | null;
  onClose: () => void;
  onSaved?: (created: LibraryQuestion) => void;
}) {
  const { run, pending, error, fieldErrors } = useAction();
  const [type, setType] = useState<QuestionType>(row?.type ?? "STAR_RATING");
  const [text, setText] = useState<Localized>(row?.text ?? {});
  const [description, setDescription] = useState<Localized>(row?.description ?? {});
  const [placeholder, setPlaceholder] = useState<Localized>(row?.placeholder ?? {});
  const [config, setConfig] = useState<QuestionConfig>(row?.config ?? {});
  const [options, setOptions] = useState<OptionDraft[]>(row?.options ?? [{ label: {} }, { label: {} }]);
  const [isActive, setIsActive] = useState(row?.isActive ?? true);

  const isChoice = CHOICE_TYPES.includes(type);
  const isText = type === "SHORT_TEXT" || type === "LONG_TEXT";
  const cfg = (patch: Partial<QuestionConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const move = (i: number, d: -1 | 1) =>
    setOptions((o) => {
      const j = i + d;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const optionErrors = Object.entries(fieldErrors)
    .filter(([k]) => k.startsWith("options"))
    .flatMap(([, v]) => v);
  const configErrors = Object.entries(fieldErrors)
    .filter(([k]) => k.startsWith("config"))
    .flatMap(([, v]) => v);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean: QuestionConfig = Object.fromEntries(
      Object.entries(config).filter(([, v]) => v !== undefined && v !== false && !Number.isNaN(v)),
    );
    run(
      () =>
        saveQuestionAction(row?.id ?? null, {
          type,
          text,
          description,
          placeholder: isText || type === "NUMBER" ? placeholder : {},
          config: clean,
          options: isChoice ? options : [],
          isActive,
        }),
      (created) => {
        if (created) onSaved?.(created as LibraryQuestion);
        onClose();
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row ? "Edit question" : "Add question"}</DialogTitle>
          <DialogDescription>
            {row && row.usageCount > 0
              ? "Changes appear in draft questionnaires that use this question. Published versions are never changed."
              : "Library questions can be reused across questionnaires."}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <Field
            label="Question type"
            htmlFor="type"
            hint={row ? "The type cannot be changed after creation." : undefined}
          >
            <NativeSelect
              id="type"
              value={type}
              disabled={!!row}
              onChange={(e) => setType(e.target.value as QuestionType)}
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <LocalizedInput
            id="text"
            label="Question text"
            required
            value={text}
            onChange={setText}
            errors={fieldErrors.text}
            maxLength={300}
          />
          <LocalizedInput
            id="description"
            label="Help text (optional)"
            value={description}
            onChange={setDescription}
            maxLength={500}
          />
          {isText || type === "NUMBER" ? (
            <LocalizedInput
              id="placeholder"
              label="Placeholder (optional)"
              value={placeholder}
              onChange={setPlaceholder}
              maxLength={120}
            />
          ) : null}

          {type === "STAR_RATING" ? (
            <Field label="Number of stars" htmlFor="scale" hint="Between 3 and 10. Default is 5.">
              <Input
                id="scale"
                type="number"
                min={3}
                max={10}
                value={config.scale ?? ""}
                onChange={(e) => cfg({ scale: num(e.target.value) })}
              />
            </Field>
          ) : null}
          {type === "NUMBER" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Minimum" htmlFor="min">
                <Input
                  id="min"
                  type="number"
                  value={config.min ?? ""}
                  onChange={(e) => cfg({ min: num(e.target.value) })}
                />
              </Field>
              <Field label="Maximum" htmlFor="max">
                <Input
                  id="max"
                  type="number"
                  value={config.max ?? ""}
                  onChange={(e) => cfg({ max: num(e.target.value) })}
                />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Checkbox checked={!!config.integer} onCheckedChange={(v) => cfg({ integer: v === true })} />{" "}
                Whole numbers only
              </label>
            </div>
          ) : null}
          {isText ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum length" htmlFor="minLength">
                <Input
                  id="minLength"
                  type="number"
                  min={0}
                  value={config.minLength ?? ""}
                  onChange={(e) => cfg({ minLength: num(e.target.value) })}
                />
              </Field>
              <Field label="Maximum length" htmlFor="maxLength">
                <Input
                  id="maxLength"
                  type="number"
                  min={1}
                  max={2000}
                  value={config.maxLength ?? ""}
                  onChange={(e) => cfg({ maxLength: num(e.target.value) })}
                />
              </Field>
            </div>
          ) : null}
          {type === "MULTIPLE_CHOICE" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum selections" htmlFor="minSelect">
                <Input
                  id="minSelect"
                  type="number"
                  min={0}
                  value={config.minSelect ?? ""}
                  onChange={(e) => cfg({ minSelect: num(e.target.value) })}
                />
              </Field>
              <Field label="Maximum selections" htmlFor="maxSelect">
                <Input
                  id="maxSelect"
                  type="number"
                  min={1}
                  value={config.maxSelect ?? ""}
                  onChange={(e) => cfg({ maxSelect: num(e.target.value) })}
                />
              </Field>
            </div>
          ) : null}
          {configErrors.map((m) => (
            <p key={m} role="alert" className="text-xs text-destructive">
              {m}
            </p>
          ))}

          {isChoice ? (
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">Options *</legend>
              {options.map((o, i) => (
                <div
                  key={o.value ?? `new-${i}`}
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto]"
                >
                  <LocalizedInput
                    id={`opt-${i}`}
                    label={`Option ${i + 1}`}
                    value={o.label}
                    onChange={(label) =>
                      setOptions((all) => all.map((x, idx) => (idx === i ? { ...x, label } : x)))
                    }
                    maxLength={120}
                  />
                  <div className="flex gap-1 sm:flex-col">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Move down"
                      disabled={i === options.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove option"
                      disabled={options.length <= 2}
                      onClick={() => setOptions((all) => all.filter((_, idx) => idx !== i))}
                    >
                      <XIcon />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setOptions((all) => [...all, { label: {} }])}
              >
                <PlusIcon /> Add option
              </Button>
              {optionErrors.map((m) => (
                <p key={m} role="alert" className="text-xs text-destructive">
                  {m}
                </p>
              ))}
            </fieldset>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} /> Active (inactive
            questions are skipped when publishing)
          </label>
          <FormError message={Object.keys(fieldErrors).length ? null : error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
