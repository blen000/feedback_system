"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/admin/form-bits";
import { SUPPORTED_LOCALES, type Localized } from "@/lib/questionnaire/types";

/** One input per supported language. The default language is required; others are optional. */
export function LocalizedInput({
  id,
  label,
  value,
  onChange,
  errors,
  multiline = false,
  required = false,
  disabled = false,
  enabledLocales,
  maxLength,
}: {
  id: string;
  label: string;
  value: Localized;
  onChange: (next: Localized) => void;
  errors?: string[];
  multiline?: boolean;
  required?: boolean;
  disabled?: boolean;
  enabledLocales?: string[];
  maxLength?: number;
}) {
  const locales = SUPPORTED_LOCALES.filter((l) => !enabledLocales || enabledLocales.includes(l.code));
  return (
    <Field label={`${label}${required ? " *" : ""}`} htmlFor={`${id}-en`} errors={errors}>
      <div className="grid gap-2">
        {locales.map((l) => {
          const Comp = multiline ? Textarea : Input;
          return (
            <div key={l.code} className="flex items-start gap-2">
              <span className="mt-2 w-14 shrink-0 text-xs font-medium uppercase text-muted-foreground">
                {l.code}
              </span>
              <Comp
                id={`${id}-${l.code}`}
                lang={l.code}
                value={value[l.code] ?? ""}
                disabled={disabled}
                maxLength={maxLength}
                placeholder={l.name}
                onChange={(e) => onChange({ ...value, [l.code]: e.target.value })}
              />
            </div>
          );
        })}
      </div>
    </Field>
  );
}
