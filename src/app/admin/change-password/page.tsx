import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { requireAuth } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const ctx = await requireAuth();
  return (
    <AuthShell
      title="Change password"
      subtitle={
        ctx.mustChangePassword
          ? "Your password was set by an administrator. Choose a new one to continue."
          : `Signed in as ${ctx.email}.`
      }
    >
      <ChangePasswordForm />
    </AuthShell>
  );
}
