import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { inspectToken } from "@/server/services/password-reset";

export const metadata: Metadata = { title: "Set your password", robots: { index: false, follow: false } };

/** Landing page for both "forgot password" and invitation emails. The link is validated on load. */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  const info = await inspectToken(value);

  if (!info.valid) {
    return (
      <AuthShell title="Link expired" subtitle="This link is invalid, has already been used, or has expired.">
        <div className="grid gap-4">
          <Link
            href="/forgot-password"
            className="flex h-11 items-center justify-center rounded-[6px] bg-[color:var(--brand-gold)] text-[15px] font-semibold text-[#2a1706] hover:brightness-105"
          >
            Request a new link
          </Link>
          <Link href="/login" className="text-center text-sm text-muted-foreground hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  const invite = info.purpose === "INVITE";
  return (
    <AuthShell
      title={invite ? "Set your password" : "Reset your password"}
      subtitle={
        invite
          ? "Choose a password to finish setting up your account."
          : "Choose a new password for your account."
      }
    >
      <ResetPasswordForm token={value} />
    </AuthShell>
  );
}
