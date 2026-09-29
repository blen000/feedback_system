"use client";

import { useActionState, useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { AuthField, authButton, authInput } from "./auth-field";
import { loginAction } from "@/server/actions/auth";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);

  return (
    <form action={action} className="grid gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

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

      <AuthField
        label="Password"
        htmlFor="password"
        labelRight={
          <button
            type="button"
            onClick={() => setHelp((h) => !h)}
            aria-expanded={help}
            className="text-sm text-[color:var(--brand-gold)] hover:underline"
          >
            Forgot password?
          </button>
        }
        right={
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="rounded-full p-1.5 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
          </button>
        }
      >
        <input
          id="password"
          name="password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          required
          placeholder="Enter password"
          className={`${authInput} pr-12`}
        />
      </AuthField>

      {help ? (
        <p role="note" className="rounded-[6px] bg-accent px-3.5 py-2.5 text-sm text-accent-foreground">
          Passwords are reset by an administrator. Contact your system administrator and you will receive a
          temporary password to change at your next sign-in.
        </p>
      ) : null}

      <label className="flex items-center gap-3 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="remember"
          className="size-4 rounded border-input accent-[color:var(--brand-gold)]"
        />
        Keep me signed in
      </label>

      {state && !state.ok ? (
        <p role="alert" className="rounded-[6px] bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={authButton}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
