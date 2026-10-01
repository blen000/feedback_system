"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { AuthField, authButton, authInput } from "./auth-field";
import { loginAction } from "@/server/actions/auth";

export function LoginForm({
  next,
  emailEnabled,
  notice,
  initialLockSeconds = 0,
}: {
  next?: string;
  emailEnabled: boolean;
  notice?: string;
  /** Seconds of lockout left when the page was rendered (server-computed). */
  initialLockSeconds?: number;
}) {
  // The server states how long is left; the browser only counts down from there. Both timestamps come
  // from one Date.now() so server and client render the same first value.
  const [clock, setClock] = useState(() => {
    const t = Date.now();
    return { now: t, endsAt: t + initialLockSeconds * 1000 };
  });
  const remaining = Math.max(0, Math.ceil((clock.endsAt - clock.now) / 1000));
  const locked = remaining > 0;

  const [state, action, pending] = useActionState(
    async (prev: Parameters<typeof loginAction>[0], formData: FormData) => {
      const res = await loginAction(prev, formData);
      if (!res.ok && res.retryAfter) {
        const t = Date.now();
        setClock({ now: t, endsAt: t + res.retryAfter * 1000 });
      }
      return res;
    },
    undefined,
  );

  useEffect(() => {
    if (!locked) return;
    const tick = () => setClock((c) => ({ ...c, now: Date.now() }));
    const id = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick); // returning to the tab re-syncs immediately
    window.addEventListener("pageshow", tick); // back/forward cache restore
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pageshow", tick);
    };
  }, [locked, clock.endsAt]);

  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (locked) e.preventDefault(); // no attempt can even be sent during the lockout
      }}
      className="grid gap-4"
    >
      {notice ? (
        <p
          role="status"
          className="rounded-[6px] bg-green-100 px-3.5 py-2.5 text-sm text-green-900 dark:bg-green-950 dark:text-green-200"
        >
          {notice}
        </p>
      ) : null}
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
          emailEnabled ? (
            <Link href="/forgot-password" className="text-sm text-[color:var(--brand-gold)] hover:underline">
              Forgot password?
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setHelp((h) => !h)}
              aria-expanded={help}
              className="text-sm text-[color:var(--brand-gold)] hover:underline"
            >
              Forgot password?
            </button>
          )
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

      {locked ? (
        <p role="alert" className="rounded-[6px] bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          Too many failed attempts. You can try again in{" "}
          <strong className="tabular-nums" aria-live="off">
            {remaining}
          </strong>{" "}
          second{remaining === 1 ? "" : "s"}.
        </p>
      ) : state && !state.ok && !state.retryAfter ? (
        <p role="alert" className="rounded-[6px] bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending || locked} className={authButton}>
        {locked ? `Try again in ${remaining}s` : pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
