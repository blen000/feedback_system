"use client";

import { NativeSelect } from "@/components/admin/form-bits";
import type { QuestionnaireLayout } from "@/lib/questionnaire/types";

const OPTIONS: { value: QuestionnaireLayout; label: string; hint: string }[] = [
  {
    value: "ONE_AT_A_TIME",
    label: "One question at a time",
    hint: "Customers answer one question per screen with a progress count (2/5). Optional questions have a Skip button.",
  },
  {
    value: "SCROLL",
    label: "Scrollable page",
    hint: "All questions are shown on one page and customers scroll through them.",
  },
];

/** Admin choice of the customer-facing layout. */
export function LayoutField({
  value,
  onChange,
  disabled,
}: {
  value: QuestionnaireLayout;
  onChange: (v: QuestionnaireLayout) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor="layout" className="text-sm font-medium">
        Customer page layout
      </label>
      <NativeSelect
        id="layout"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as QuestionnaireLayout)}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      <p className="text-xs text-muted-foreground">{OPTIONS.find((o) => o.value === value)?.hint}</p>
    </div>
  );
}
