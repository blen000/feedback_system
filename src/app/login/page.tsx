import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { BANK_NAME } from "@/components/brand/brand";
import { getAuthContext, loginLockSecondsLeft } from "@/lib/auth/session";
import { emailEnabled } from "@/lib/mail/mailer";
import { SESSION_IDLE_MS } from "@/server/services/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // /admin picks the first page this user may open (not every role has the dashboard)
  if (await getAuthContext()) redirect("/admin");
  const { next, reset, timeout } = await searchParams;
  const lockSeconds = await loginLockSecondsLeft(); // keeps the countdown running across refreshes
  return (
    <AuthShell title="Sign in" subtitle={`to continue to ${BANK_NAME}`}>
      <LoginForm
        next={typeof next === "string" ? next : undefined}
        emailEnabled={emailEnabled()}
        initialLockSeconds={lockSeconds}
        notice={
          reset === "1"
            ? "Password updated. Sign in with your new password."
            : timeout === "1"
              ? `You were signed out after ${SESSION_IDLE_MS / 60_000} minutes of inactivity. Please sign in again.`
              : undefined
        }
      />
    </AuthShell>
  );
}
