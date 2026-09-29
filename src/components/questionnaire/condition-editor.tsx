"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/admin/form-bits";
import {
  pick,
  type Visibility,
  type VisibilityOperator,
  type VisibilityRule,
} from "@/lib/questionnaire/types";
import type { EditorQuestion } from "@/server/services/questionnaires";

const OPERATORS_BY_TYPE: Record<string, { op: VisibilityOperator; label: string }[]> = {
  YES_NO: [
    { op: "equals", label: "is" },
    { op: "not_equals", label: "is not" },
    { op: "answered", label: "is answered" },
  ],
  CHOICE: [
    { op: "equals", label: "is" },
    { op: "not_equals", label: "is not" },
    { op: "answered", label: "is answered" },
  ],
  NUMERIC: [
    { op: "lte", label: "is at most" },
    { op: "gte", label: "is at least" },
    { op: "equals", label: "is exactly" },
    { op: "answered", label: "is answered" },
  ],
  TEXT: [{ op: "answered", label: "is answered" }],
};

function family(type: string): keyof typeof OPERATORS_BY_TYPE {
  if (type === "YES_NO") return "YES_NO";
  if (type === "SINGLE_CHOICE" || type === "MULTIPLE_CHOICE") return "CHOICE";
  if (type === "SHORT_TEXT" || type === "LONG_TEXT") return "TEXT";
  return "NUMERIC";
}

const label = (q: EditorQuestion) => pick(q.library.text, "en") || "(untitled)";

/**
 * Shows an item only when earlier answers match. Rules can only reference EARLIER questions,
 * so conditions can never loop or wait on something the customer has not seen yet.
 */
export function ConditionEditor({
  value,
  earlier,
  disabled,
  onChange,
}: {
  value: Visibility | null;
  earlier: EditorQuestion[];
  disabled: boolean;
  onChange: (v: Visibility | null) => void;
}) {
  const v: Visibility = value ?? { match: "all", rules: [] };
  const byRef = new Map(earlier.map((q) => [q.ref, q]));

  const commit = (next: Visibility) => onChange(next.rules.length ? next : null);
  const setRule = (i: number, patch: Partial<VisibilityRule>) =>
    commit({ ...v, rules: v.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });

  function addRule() {
    const first = earlier[0];
    if (!first) return;
    commit({ ...v, rules: [...v.rules, defaultRule(first)] });
  }

  if (earlier.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Conditions can use earlier questions. Move this question down to add one.
      </p>
    );
  }

  return (
    <div className="grid gap-2 rounded-md bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Show this question only if</span>
        {v.rules.length > 1 ? (
          <NativeSelect
            className="w-auto"
            disabled={disabled}
            value={v.match}
            onChange={(e) => commit({ ...v, match: e.target.value as "all" | "any" })}
          >
            <option value="all">all</option>
            <option value="any">any</option>
          </NativeSelect>
        ) : null}
        <span>{v.rules.length ? "of these are true:" : "— no condition (always shown)."}</span>
      </div>

      {v.rules.map((r, i) => {
        const target = byRef.get(r.questionRef);
        const fam = target ? family(target.library.type) : "TEXT";
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
            <NativeSelect
              aria-label="Question"
              disabled={disabled}
              value={target ? r.questionRef : ""}
              onChange={(e) => {
                const q = byRef.get(e.target.value);
                if (q) setRule(i, defaultRule(q));
              }}
            >
              {!target ? <option value="">⚠ (question moved or removed)</option> : null}
              {earlier.map((q, n) => (
                <option key={q.ref} value={q.ref}>
                  {n + 1}. {label(q)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Condition"
              disabled={disabled || !target}
              value={r.operator}
              onChange={(e) =>
                setRule(i, {
                  operator: e.target.value as VisibilityOperator,
                  value: e.target.value === "answered" ? undefined : r.value,
                })
              }
            >
              {OPERATORS_BY_TYPE[fam].map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <ValueInput
              rule={r}
              target={target}
              disabled={disabled}
              onChange={(value) => setRule(i, { value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove condition"
              disabled={disabled}
              onClick={() => commit({ ...v, rules: v.rules.filter((_, idx) => idx !== i) })}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}

      {!disabled ? (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addRule}>
          <PlusIcon /> Add condition
        </Button>
      ) : null}
    </div>
  );
}

function defaultRule(q: EditorQuestion): VisibilityRule {
  const fam = family(q.library.type);
  if (fam === "YES_NO") return { questionRef: q.ref, operator: "equals", value: "no" };
  if (fam === "CHOICE") return { questionRef: q.ref, operator: "equals", value: q.library.options[0]?.value };
  if (fam === "NUMERIC")
    return { questionRef: q.ref, operator: "lte", value: q.library.type === "NPS" ? 6 : 2 };
  return { questionRef: q.ref, operator: "answered" };
}

function ValueInput({
  rule,
  target,
  disabled,
  onChange,
}: {
  rule: VisibilityRule;
  target?: EditorQuestion;
  disabled: boolean;
  onChange: (v: VisibilityRule["value"]) => void;
}) {
  if (!target || rule.operator === "answered") return <span />;
  const fam = family(target.library.type);
  if (fam === "YES_NO") {
    return (
      <NativeSelect
        aria-label="Value"
        disabled={disabled}
        value={String(rule.value ?? "no")}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </NativeSelect>
    );
  }
  if (fam === "CHOICE") {
    return (
      <NativeSelect
        aria-label="Value"
        disabled={disabled}
        value={String(rule.value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      >
        {target.library.options.map((o) => (
          <option key={o.value} value={o.value}>
            {pick(o.label, "en")}
          </option>
        ))}
      </NativeSelect>
    );
  }
  return (
    <Input
      aria-label="Value"
      type="number"
      disabled={disabled}
      value={typeof rule.value === "number" ? rule.value : ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
    />
  );
}
