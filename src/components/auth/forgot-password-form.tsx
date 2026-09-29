"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AuthField, authButton, authInput } from "./auth-field";
import { forgotPasswordAction } from "@/server/actions/auth";

export function ForgotPasswordForm({ minutes }: { minutes: number }) {
  const [state, action, pending] = useActionState(forgotPasswordAction, undefined);

  if (state?.ok) {
    return (
      <div className="grid gap-5">
        <p role="status" className="rounded-[6px] bg-accent px-3.5 py-3 text-sm text-accent-foreground">
          If an account exists for that email address, we have sent a link to reset the password. It works
          once and expires in {minutes} minutes. Please also check your spam folder.
        </p>
        <Link href="/login" className="text-center text-sm text-[color:var(--brand-gold)] hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <AuthField label="Email" htmlFor="email">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="someone@example.com"
          className={authInput}
        />
      </AuthField>
      {state && !state.ok ? (
        <p role="alert" className="rounded-[6px] bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={authButton}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
      <Link href="/login" className="text-center text-sm text-muted-foreground hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
