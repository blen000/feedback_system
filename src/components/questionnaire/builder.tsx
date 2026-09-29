"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmButton } from "@/components/admin/confirm-dialog";
import { FormError, NativeSelect } from "@/components/admin/form-bits";
import { useAction } from "@/components/admin/use-action";
import { AssignmentsCard, type LocationOptions } from "./assignments-card";
import { ConditionEditor } from "./condition-editor";
import { LocalizedInput } from "./localized-input";
import { PreviewDialog } from "./preview-dialog";
import { QuestionDialog } from "./questions-manager";
import { StatusBadge } from "./questionnaires-list";
import {
  activateAction,
  closeAction,
  deleteQuestionnaireAction,
  pauseAction,
  previewAction,
  publishAction,
  reopenAction,
  saveDraftAction,
} from "@/server/actions/questionnaires";
import {
  QUESTION_TYPE_LABELS,
  RATING_TYPES,
  SUPPORTED_LOCALES,
  pick,
  type Localized,
  type QuestionnaireDefinition,
} from "@/lib/questionnaire/types";
import type { LibraryQuestion } from "@/server/services/questions";
import type { EditorQuestion, getQuestionnaireEditor } from "@/server/services/questionnaires";

type Editor = Awaited<ReturnType<typeof getQuestionnaireEditor>>;

export function QuestionnaireBuilder({
  initial,
  library,
  locations,
  perms,
}: {
  initial: Editor;
  library: LibraryQuestion[];
  locations: LocationOptions | null;
  perms: { update: boolean; publish: boolean; delete: boolean };
}) {
  const router = useRouter();
  const save = useAction();
  const life = useAction();
  const [meta, setMeta] = useState(initial.meta);
  const [items, setItems] = useState<EditorQuestion[]>(initial.questions);
  const [dirty, setDirty] = useState(false);
  const [pickId, setPickId] = useState("");
  const [preview, setPreview] = useState<QuestionnaireDefinition | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [openConditions, setOpenConditions] = useState<Set<string>>(new Set());

  const editable = initial.status === "DRAFT" && perms.update;
  // Questions created from this screen appear immediately; the server-provided library catches up on refresh.
  const [created, setCreated] = useState<LibraryQuestion[]>([]);
  const [creating, setCreating] = useState(false);
  // Any active library question can be added, and the same one can be added as many times as needed.
  const pool = [...new Map([...library, ...created].map((q) => [q.id, q])).values()].filter(
    (q) => q.isActive,
  );
  const problems = [...Object.values(save.fieldErrors).flat(), ...(life.fieldErrors._ ?? [])];

  const change =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };
  const patchItem = (ref: string, patch: Partial<EditorQuestion>) => {
    setItems((all) => all.map((i) => (i.ref === ref ? { ...i, ...patch } : i)));
    setDirty(true);
  };
  const move = (i: number, d: -1 | 1) => {
    setItems((all) => {
      const j = i + d;
      if (j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  };
  function pushQuestion(q: LibraryQuestion) {
    setItems((all) => [
      ...all,
      {
        ref: crypto.randomUUID(),
        questionId: q.id,
        isRequired: false,
        isActive: true,
        isPrimaryRating: false,
        visibility: null,
        library: q,
      },
    ]);
    setDirty(true);
  }
  function addFromLibrary() {
    const q = pool.find((l) => l.id === (pickId || pool[0]?.id));
    if (!q) return;
    pushQuestion(q);
  }

  const payload = () => ({
    meta,
    questions: items.map((i) => ({
      ref: i.ref,
      questionId: i.questionId,
      isRequired: i.isRequired,
      isActive: i.isActive,
      isPrimaryRating: i.isPrimaryRating,
      visibility: i.visibility,
    })),
  });

  async function openPreview() {
    setPreviewing(true);
    try {
      if (dirty && editable) {
        const saved = await saveDraftAction(initial.id, payload());
        if (!saved.ok) {
          toast.error(saved.error);
          return;
        }
        setDirty(false);
      }
      const res = await previewAction(initial.id);
      if (res.ok && res.data) setPreview(res.data);
      else toast.error(res.ok ? "Nothing to preview." : res.error);
    } finally {
      setPreviewing(false);
    }
  }

  const status = initial.status;
  const toggleCondition = (ref: string) =>
    setOpenConditions((s) => {
      const n = new Set(s);
      if (n.has(ref)) n.delete(ref);
      else n.add(ref);
      return n;
    });

  return (
    <div className="space-y-6">
      {/* Status & lifecycle */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            <span className="text-sm text-muted-foreground">
              {initial.latestVersion
                ? `Latest published version: v${initial.latestVersion}`
                : "Never published"}
            </span>
          </div>
          {perms.publish || perms.update ? (
            <div className="flex flex-wrap gap-2">
              {status === "DRAFT" && perms.publish ? (
                <Button
                  disabled={dirty || life.pending}
                  onClick={() => life.run(() => publishAction(initial.id))}
                  title={dirty ? "Save your changes first" : undefined}
                >
                  {life.pending ? "Publishing…" : "Publish"}
                </Button>
              ) : null}
              {(status === "PUBLISHED" || status === "PAUSED") && perms.publish ? (
                <ConfirmButton
                  variant="outline"
                  size="default"
                  label="Activate"
                  title="Start collecting feedback?"
                  description="Customers scanning QR codes at the assigned locations will see this questionnaire immediately."
                  confirmLabel="Activate"
                  action={() => activateAction(initial.id)}
                />
              ) : null}
              {status === "ACTIVE" && perms.publish ? (
                <ConfirmButton
                  variant="outline"
                  size="default"
                  label="Pause"
                  title="Pause this questionnaire?"
                  description="Customers will see a “currently closed” message until it is activated again."
                  confirmLabel="Pause"
                  action={() => pauseAction(initial.id)}
                />
              ) : null}
              {(status === "PUBLISHED" || status === "PAUSED") && perms.update ? (
                <ConfirmButton
                  variant="outline"
                  size="default"
                  label="Edit as new version"
                  title="Reopen as a draft?"
                  description="It stops accepting feedback until you publish and activate it again. Existing feedback and earlier versions are not affected."
                  confirmLabel="Reopen as draft"
                  action={() => reopenAction(initial.id)}
                />
              ) : null}
              {status !== "DRAFT" && status !== "CLOSED" && perms.publish ? (
                <ConfirmButton
                  label="Close"
                  title="Close this questionnaire permanently?"
                  description="A closed questionnaire cannot be reopened. Collected feedback is kept."
                  confirmLabel="Close questionnaire"
                  action={() => closeAction(initial.id)}
                />
              ) : null}
              {status !== "ACTIVE" && perms.delete ? (
                <ConfirmButton
                  label="Delete"
                  title="Delete this questionnaire?"
                  description="It will be removed from the list. Collected feedback is kept."
                  confirmLabel="Delete"
                  action={async () => {
                    const r = await deleteQuestionnaireAction(initial.id);
                    if (r.ok) router.push("/admin/questionnaires");
                    return r;
                  }}
                />
              ) : null}
            </div>
          ) : null}
          <div className="w-full">
            <FormError message={life.fieldErrors._ ? null : life.error} />
          </div>
        </CardContent>
      </Card>

      {status !== "DRAFT" ? (
        <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
          {status === "CLOSED"
            ? "This questionnaire is closed and can no longer be edited."
            : "Published versions are locked so collected feedback always matches the form it was answered on. Use “Edit as new version” to change it."}
        </p>
      ) : null}

      {problems.length ? (
        <div role="alert" className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Please fix the following:</p>
          <ul className="mt-1 list-disc pl-5">
            {[...new Set(problems)].map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <LocalizedInput
            id="title"
            label="Title"
            required
            value={meta.title}
            onChange={change((title: Localized) => setMeta((m) => ({ ...m, title })))}
            enabledLocales={meta.locales}
            disabled={!editable}
            maxLength={150}
          />
          <LocalizedInput
            id="description"
            label="Description"
            multiline
            value={meta.description}
            onChange={change((description: Localized) => setMeta((m) => ({ ...m, description })))}
            enabledLocales={meta.locales}
            disabled={!editable}
            maxLength={500}
          />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {SUPPORTED_LOCALES.map((l) => (
              <label key={l.code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={meta.locales.includes(l.code)}
                  disabled={!editable || l.code === meta.defaultLocale}
                  onCheckedChange={(v) => {
                    setMeta((m) => ({
                      ...m,
                      locales: v === true ? [...m.locales, l.code] : m.locales.filter((x) => x !== l.code),
                    }));
                    setDirty(true);
                  }}
                />
                {l.name}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={meta.collectContact}
                disabled={!editable}
                onCheckedChange={(v) => {
                  setMeta((m) => ({ ...m, collectContact: v === true }));
                  setDirty(true);
                }}
              />
              Offer optional follow-up contact (phone)
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Questions */}
      <Card>
        <CardHeader>
          <CardTitle>Questions ({items.length})</CardTitle>
          <CardDescription>
            Customers see active questions in this order. Conditions can only depend on earlier questions.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {items.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No questions yet. Add one from the library below.
            </p>
          ) : null}
          {items.map((it, i) => {
            const isRating = RATING_TYPES.includes(it.library.type);
            const showCond = openConditions.has(it.ref) || !!it.visibility;
            return (
              <div key={it.ref} className={`rounded-lg border p-4 ${it.isActive ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {i + 1}. {pick(it.library.text, meta.defaultLocale) || "(untitled)"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="outline">{QUESTION_TYPE_LABELS[it.library.type]}</Badge>
                      {it.isRequired ? <Badge variant="secondary">Required</Badge> : null}
                      {it.isPrimaryRating ? <Badge>Overall rating</Badge> : null}
                      {it.visibility ? <Badge variant="secondary">Conditional</Badge> : null}
                      {!it.library.isActive ? (
                        <Badge variant="destructive">Library question inactive</Badge>
                      ) : null}
                    </div>
                  </div>
                  {editable ? (
                    <div className="flex gap-1">
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
                        disabled={i === items.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove question"
                        onClick={() => {
                          setItems((all) => all.filter((x) => x.ref !== it.ref));
                          setDirty(true);
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={it.isRequired}
                      disabled={!editable}
                      onCheckedChange={(v) => patchItem(it.ref, { isRequired: v === true })}
                    />{" "}
                    Required
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={it.isActive}
                      disabled={!editable}
                      onCheckedChange={(v) => patchItem(it.ref, { isActive: v === true })}
                    />{" "}
                    Active
                  </label>
                  {isRating ? (
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={it.isPrimaryRating}
                        disabled={!editable}
                        onCheckedChange={(v) => {
                          // only one question may be the overall rating
                          setItems((all) =>
                            all.map((x) => ({
                              ...x,
                              isPrimaryRating: x.ref === it.ref ? v === true : false,
                            })),
                          );
                          setDirty(true);
                        }}
                      />
                      Use as overall rating
                    </label>
                  ) : null}
                  {editable || it.visibility ? (
                    <button
                      type="button"
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={() => toggleCondition(it.ref)}
                    >
                      {showCond ? "Hide condition" : "Add condition"}
                    </button>
                  ) : null}
                </div>

                {showCond ? (
                  <div className="mt-3">
                    <ConditionEditor
                      value={it.visibility}
                      earlier={items.slice(0, i)}
                      disabled={!editable}
                      onChange={(visibility) => patchItem(it.ref, { visibility })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}

          {editable ? (
            <div className="grid gap-3 border-t pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => setCreating(true)}>
                  <PlusIcon /> Create new question
                </Button>
                <span className="text-sm text-muted-foreground">
                  Any type, as many as you need — for example several rating or multiple-choice questions.
                </span>
              </div>
              {pool.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    className="w-auto min-w-64 max-w-full"
                    aria-label="Question from the library"
                    value={pickId || pool[0]?.id || ""}
                    onChange={(e) => setPickId(e.target.value)}
                  >
                    {pool.map((q) => (
                      <option key={q.id} value={q.id}>
                        {pick(q.text, "en")} — {QUESTION_TYPE_LABELS[q.type]}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="button" variant="outline" onClick={addFromLibrary}>
                    <PlusIcon /> Add from library
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    The same question can be added more than once.
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={openPreview} disabled={previewing}>
          <EyeIcon /> {previewing ? "Preparing…" : "Preview"}
        </Button>
        {editable ? (
          <Button
            onClick={() =>
              save.run(
                () => saveDraftAction(initial.id, payload()),
                () => setDirty(false),
              )
            }
            disabled={!dirty || save.pending}
          >
            <SaveIcon /> {save.pending ? "Saving…" : "Save draft"}
          </Button>
        ) : null}
        {dirty ? <span className="text-sm text-amber-700 dark:text-amber-400">Unsaved changes</span> : null}
        <FormError message={Object.keys(save.fieldErrors).length ? null : save.error} />
      </div>

      <AssignmentsCard
        questionnaireId={initial.id}
        initial={initial.assignments.map((a) => ({ scopeType: a.scopeType, id: a.id, label: a.label }))}
        options={locations}
        editable={perms.publish && status !== "CLOSED"}
      />

      {creating ? (
        <QuestionDialog
          row={null}
          onClose={() => setCreating(false)}
          onSaved={(q) => {
            setCreated((c) => [...c, q]);
            pushQuestion(q);
          }}
        />
      ) : null}

      {preview ? <PreviewDialog definition={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
