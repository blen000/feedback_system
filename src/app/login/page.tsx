import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { BANK_NAME } from "@/components/brand/brand";
import { getAuthContext } from "@/lib/auth/session";
import { emailEnabled } from "@/lib/mail/mailer";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getAuthContext()) redirect("/admin/dashboard");
  const { next, reset } = await searchParams;
  return (
    <AuthShell title="Sign in" subtitle={`to continue to ${BANK_NAME}`}>
      <LoginForm
        next={typeof next === "string" ? next : undefined}
        emailEnabled={emailEnabled()}
        notice={reset === "1" ? "Password updated. Sign in with your new password." : undefined}
      />
    </AuthShell>
  );
}
