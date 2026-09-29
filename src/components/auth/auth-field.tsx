import * as React from "react";

/** Plain bordered input used on the sign-in screens; gold focus ring. */
export const authInput =
  "h-11 w-full rounded-[6px] border border-input bg-white px-3.5 text-[15px] outline-none transition-colors placeholder:text-muted-foreground/80 focus:border-[color:var(--brand-gold)] focus:ring-4 focus:ring-[color:var(--brand-gold)]/20 dark:bg-muted";

/** Gold call-to-action button used on the sign-in screens. */
export const authButton =
  "h-11 w-full rounded-[6px] bg-[color:var(--brand-gold)] text-[15px] font-semibold text-[#2a1706] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--brand-gold)]/40 disabled:opacity-70";

export function AuthField({
  label,
  htmlFor,
  right,
  labelRight,
  errors,
  children,
}: {
  label: string;
  htmlFor: string;
  /** control shown inside the input on the right (e.g. show/hide password) */
  right?: React.ReactNode;
  /** content on the label row's right edge (e.g. "Forgot password?") */
  labelRight?: React.ReactNode;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-sm font-semibold">
          {label}
        </label>
        {labelRight}
      </div>
      <div className="relative">
        {children}
        {right ? <span className="absolute right-3 top-1/2 -translate-y-1/2">{right}</span> : null}
      </div>
      {errors?.map((e) => (
        <p key={e} role="alert" className="mt-1.5 text-xs text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}
