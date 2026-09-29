"use server";

import { requestMeta } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { GENERIC_MESSAGE, submitFeedback } from "@/server/services/feedback";

export type PublicResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Public, unauthenticated endpoint (used by /f/[code]). All validation is server-side;
 * only customer-safe messages are ever returned — never stack traces or database details.
 */
export async function submitFeedbackAction(publicCode: string, payload: unknown): Promise<PublicResult> {
  try {
    await submitFeedback(String(publicCode).slice(0, 16), payload, await requestMeta());
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) {
      const fieldErrors = e.fieldErrors
        ? Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0]]))
        : undefined;
      return { ok: false, error: e.message, fieldErrors };
    }
    console.error("Public submission failed", e);
    return { ok: false, error: GENERIC_MESSAGE };
  }
}
