"use client";

import { useActionState } from "react";
import { AuthField, authButton, authInput } from "./auth-field";
import { resetPasswordAction } from "@/server/actions/auth";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <AuthField label="New password" htmlFor="newPassword" errors={fe.newPassword}>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          className={authInput}
        />
      </AuthField>
      <p className="-mt-2 text-xs text-muted-foreground">
        At least 10 characters with upper- and lower-case letters, a number and a special character.
      </p>
      <AuthField label="Confirm new password" htmlFor="confirmPassword" errors={fe.confirmPassword}>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={authInput}
        />
      </AuthField>
      {state && !state.ok && !state.fieldErrors ? (
        <p role="alert" className="rounded-[6px] bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={authButton}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
