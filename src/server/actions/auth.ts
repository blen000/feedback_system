"use server";

import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import {
  clearSessionCookie,
  getAuthContext,
  readSessionToken,
  requestMeta,
  setSessionCookie,
} from "@/lib/auth/session";
import { changeOwnPassword, login, logout } from "@/server/services/auth";
import { completePasswordReset, requestPasswordReset } from "@/server/services/password-reset";
import type { ActionResult } from "./helpers";

/** Only same-site relative paths under /admin are honored, preventing open redirects. */
function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/admin(\/[\w\-./]*)?$/.test(next) ? next : "/admin/dashboard";
}

export async function loginAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  let target: string;
  try {
    const result = await login(
      { email: formData.get("email"), password: formData.get("password") },
      await requestMeta(),
    );
    await setSessionCookie(result.token, result.expiresAt, formData.get("remember") === "on");
    target = result.mustChangePassword ? "/admin/change-password" : safeNext(formData.get("next"));
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("Login failed unexpectedly", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  redirect(target); // outside try/catch: redirect() works by throwing
}

export async function logoutAction(): Promise<void> {
  await logout(await readSessionToken(), await requestMeta());
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  try {
    await changeOwnPassword(
      ctx,
      {
        currentPassword: formData.get("currentPassword"),
        newPassword: formData.get("newPassword"),
        confirmPassword: formData.get("confirmPassword"),
      },
      await requestMeta(),
    );
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error("Password change failed unexpectedly", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  redirect("/admin/dashboard");
}

/**
 * "Forgot password". The answer is identical whether or not the email belongs to an account
 * (see requestPasswordReset), so this form cannot be used to discover who has one.
 */
export async function forgotPasswordAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requestPasswordReset(formData.get("email"), await requestMeta());
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("Password reset request failed unexpectedly", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function resetPasswordAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await completePasswordReset(
      {
        token: formData.get("token"),
        newPassword: formData.get("newPassword"),
        confirmPassword: formData.get("confirmPassword"),
      },
      await requestMeta(),
    );
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error("Password reset failed unexpectedly", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  redirect("/login?reset=1"); // outside try/catch: redirect() works by throwing
}
