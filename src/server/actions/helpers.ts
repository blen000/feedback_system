import "server-only";
import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { getAuthContext } from "@/lib/auth/session";
import type { AuthContext } from "@/lib/rbac/authorize";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Wraps every server action: authenticates from the session cookie, runs the callback
 * (services perform the actual permission checks) and converts errors into safe results.
 * Client-supplied user/role/permission data is never trusted — only the session is.
 */
export async function runAction<T>(
  fn: (ctx: AuthContext) => Promise<T>,
  opts: { revalidate?: string[]; message?: string } = {},
): Promise<ActionResult<T>> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return { ok: false, error: "Your session has expired. Please sign in again." };
    if (ctx.mustChangePassword) return { ok: false, error: "You must change your password first." };
    const data = await fn(ctx);
    for (const p of opts.revalidate ?? []) revalidatePath(p);
    return { ok: true, data, message: opts.message };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error("Unhandled action error", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
