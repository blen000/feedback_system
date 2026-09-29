import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { emailEnabled } from "@/lib/mail/mailer";
import { RESET_MINUTES } from "@/server/services/password-reset";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot password"
      subtitle="Enter your email and we will send you a link to choose a new one."
    >
      {emailEnabled() ? (
        <ForgotPasswordForm minutes={RESET_MINUTES} />
      ) : (
        <div className="grid gap-5">
          <p role="note" className="rounded-[6px] bg-accent px-3.5 py-3 text-sm text-accent-foreground">
            Password reset by email is not set up. Please contact your system administrator; they can give you
            a temporary password.
          </p>
          <Link href="/login" className="text-center text-sm text-[color:var(--brand-gold)] hover:underline">
            Back to sign in
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
