"use client";

import { useMemo, useState } from "react";
import { StarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateSubmission, visibleRefs } from "@/lib/questionnaire/engine";
import {
  EMOJI_SCALE,
  SUPPORTED_LOCALES,
  pick,
  type DefinitionQuestion,
  type QuestionnaireDefinition,
  type RawAnswers,
} from "@/lib/questionnaire/types";

export interface FormSubmission {
  answers: RawAnswers;
  locale: string;
  wantsFollowUp: boolean;
  contactPhone: string | null;
}

/**
 * Customer-facing questionnaire. Used by the admin preview and the public page.
 * Client-side validation here is for usability only — the server re-validates everything.
 */
export function QuestionnaireForm({
  definition,
  onSubmit,
  submitLabel = "Submit feedback",
  disabled = false,
  serverErrors,
}: {
  definition: QuestionnaireDefinition;
  onSubmit: (s: FormSubmission) => void | Promise<void>;
  submitLabel?: string;
  disabled?: boolean;
  serverErrors?: Record<string, string>;
}) {
  const [locale, setLocale] = useState(definition.defaultLocale);
  const [answers, setAnswers] = useState<RawAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [wantsFollowUp, setWantsFollowUp] = useState(false);
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const visible = useMemo(() => visibleRefs(definition, answers), [definition, answers]);
  const shown = definition.questions.filter((q) => visible.has(q.ref));
  const answered = shown.filter((q) => !isBlank(answers[q.ref])).length;
  const allErrors = { ...errors, ...serverErrors };

  function set(ref: string, value: unknown) {
    setAnswers((a) => {
      const next = { ...a };
      if (isBlank(value)) delete next[ref];
      else next[ref] = value;
      return next;
    });
    setErrors((e) => (ref in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== ref)) : e));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateSubmission(definition, answers);
    const found: Record<string, string> = result.ok ? {} : result.errors;
    if (wantsFollowUp && definition.collectContact && !/^\+?[0-9 ()-]{7,20}$/.test(phone.trim())) {
      found._phone = "Enter a valid phone number.";
    }
    setErrors(found);
    if (Object.keys(found).length) {
      document
        .getElementById(`q-${Object.keys(found)[0]}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    try {
      // send only answers to currently-visible questions
      const clean = Object.fromEntries(Object.entries(answers).filter(([ref]) => visible.has(ref)));
      await onSubmit({
        answers: clean,
        locale,
        wantsFollowUp: definition.collectContact && wantsFollowUp,
        contactPhone: definition.collectContact && wantsFollowUp ? phone.trim() : null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const title = pick(definition.title, locale, definition.defaultLocale);
  const description = pick(definition.description, locale, definition.defaultLocale);

  return (
    <form onSubmit={submit} noValidate className="mx-auto w-full max-w-xl space-y-6">
      <header className="space-y-2">
        {definition.locales.length > 1 ? (
          <div className="flex gap-2" role="group" aria-label="Language">
            {SUPPORTED_LOCALES.filter((l) => definition.locales.includes(l.code)).map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLocale(l.code)}
                aria-pressed={locale === l.code}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  locale === l.code ? "border-primary bg-primary text-primary-foreground" : "bg-background",
                )}
              >
                {l.name}
              </button>
            ))}
          </div>
        ) : null}
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {description ? <p className="text-base text-muted-foreground">{description}</p> : null}
        {shown.length > 4 ? (
          <div className="pt-1">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-[#e3dccf] dark:bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={shown.length}
              aria-valuenow={answered}
            >
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(answered / shown.length) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {answered} / {shown.length}
            </p>
          </div>
        ) : null}
      </header>

      {shown.map((q, i) => (
        <QuestionBlock
          key={q.ref}
          q={q}
          index={i + 1}
          locale={locale}
          defaultLocale={definition.defaultLocale}
          value={answers[q.ref]}
          error={allErrors[q.ref]}
          onChange={(v) => set(q.ref, v)}
        />
      ))}

      {definition.collectContact ? (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <label className="flex items-start gap-3 text-base">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={wantsFollowUp}
              onChange={(e) => setWantsFollowUp(e.target.checked)}
            />
            <span>Would you like us to contact you about this feedback?</span>
          </label>
          {wantsFollowUp ? (
            <div className="space-y-1">
              <label htmlFor="contact-phone" className="text-sm font-medium">
                Phone number
              </label>
              <input
                id="contact-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-12 w-full rounded-lg border bg-background px-3 text-base"
              />
              {allErrors._phone ? (
                <p role="alert" className="text-sm text-destructive">
                  {allErrors._phone}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {allErrors._ ? (
        <p role="alert" className="text-sm text-destructive">
          {allErrors._}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={disabled || submitting}
        className="h-14 w-full rounded-xl bg-primary text-lg font-medium text-primary-foreground disabled:opacity-60"
      >
        {submitting ? "Sending…" : submitLabel}
      </button>
    </form>
  );
}

function isBlank(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function QuestionBlock({
  q,
  index,
  locale,
  defaultLocale,
  value,
  error,
  onChange,
}: {
  q: DefinitionQuestion;
  index: number;
  locale: string;
  defaultLocale: string;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const t = (l?: Record<string, string>) => pick(l, locale, defaultLocale);
  const id = `q-${q.ref}`;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-label`}
      className={cn("space-y-3 rounded-xl border bg-card p-4", error && "border-destructive")}
    >
      <div>
        <h2 id={`${id}-label`} className="text-lg font-medium leading-snug">
          {index}. {t(q.text)}
          {q.required ? (
            <span aria-label="required" className="ml-1 text-destructive">
              *
            </span>
          ) : null}
        </h2>
        {q.description && t(q.description) ? (
          <p className="mt-1 text-sm text-muted-foreground">{t(q.description)}</p>
        ) : null}
      </div>
      <Input q={q} t={t} id={id} value={value} onChange={onChange} />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const choiceBtn = (on: boolean) =>
  cn(
    "min-h-12 rounded-lg border px-4 py-2 text-base transition-colors",
    on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
  );

function Input({
  q,
  t,
  id,
  value,
  onChange,
}: {
  q: DefinitionQuestion;
  t: (l?: Record<string, string>) => string;
  id: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (q.type) {
    case "YES_NO":
      return (
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby={`${id}-label`}>
          {(["yes", "no"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={value === v}
              onClick={() => onChange(value === v ? undefined : v)}
              className={choiceBtn(value === v)}
            >
              {v === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      );

    case "STAR_RATING": {
      const scale = q.config.scale ?? 5;
      const current = typeof value === "number" ? value : 0;
      return (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-labelledby={`${id}-label`}>
          {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={current === n}
              aria-label={`${n} of ${scale}`}
              onClick={() => onChange(current === n ? undefined : n)}
              className="p-1"
            >
              <StarIcon
                className={cn(
                  "size-9 sm:size-10",
                  n <= current ? "fill-[#e99d02] text-[#e99d02]" : "text-muted-foreground/40",
                )}
              />
            </button>
          ))}
        </div>
      );
    }

    case "EMOJI_RATING":
      return (
        <div className="flex justify-between gap-1" role="radiogroup" aria-labelledby={`${id}-label`}>
          {EMOJI_SCALE.map((e, i) => (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={value === i + 1}
              aria-label={`${i + 1} of ${EMOJI_SCALE.length}`}
              onClick={() => onChange(value === i + 1 ? undefined : i + 1)}
              className={cn(
                "flex-1 rounded-lg border py-2 text-3xl sm:text-4xl",
                value === i + 1
                  ? "border-primary bg-primary/10"
                  : "bg-background opacity-70 hover:opacity-100",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      );

    case "NPS":
      return (
        <div>
          <div
            className="grid grid-cols-6 gap-2 sm:grid-cols-11"
            role="radiogroup"
            aria-labelledby={`${id}-label`}
          >
            {Array.from({ length: 11 }, (_, n) => n).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value === n}
                onClick={() => onChange(value === n ? undefined : n)}
                className={cn(choiceBtn(value === n), "px-0")}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>Not likely</span>
            <span>Very likely</span>
          </div>
        </div>
      );

    case "SINGLE_CHOICE":
      return (
        <div className="grid gap-2" role="radiogroup" aria-labelledby={`${id}-label`}>
          {q.options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={value === o.value}
              onClick={() => onChange(value === o.value ? undefined : o.value)}
              className={cn(choiceBtn(value === o.value), "text-left")}
            >
              {t(o.label)}
            </button>
          ))}
        </div>
      );

    case "MULTIPLE_CHOICE": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
          {q.options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? selected.filter((x) => x !== o.value) : [...selected, o.value])}
                className={cn(choiceBtn(on), "text-left")}
              >
                {on ? "✓ " : ""}
                {t(o.label)}
              </button>
            );
          })}
        </div>
      );
    }

    case "SHORT_TEXT":
      return (
        <input
          type="text"
          aria-labelledby={`${id}-label`}
          maxLength={q.config.maxLength ?? 200}
          placeholder={t(q.placeholder)}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full rounded-lg border bg-background px-3 text-base"
        />
      );

    case "LONG_TEXT":
      return (
        <textarea
          aria-labelledby={`${id}-label`}
          rows={4}
          maxLength={q.config.maxLength ?? 2000}
          placeholder={t(q.placeholder)}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border bg-background px-3 py-2 text-base"
        />
      );

    case "NUMBER":
      return (
        <input
          type="number"
          inputMode={q.config.integer ? "numeric" : "decimal"}
          aria-labelledby={`${id}-label`}
          min={q.config.min}
          max={q.config.max}
          step={q.config.integer ? 1 : "any"}
          placeholder={t(q.placeholder)}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className="h-12 w-full rounded-lg border bg-background px-3 text-base"
        />
      );
  }
}
