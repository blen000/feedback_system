import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateToken, type RequestMeta } from "@/server/services/auth";
import { can, type AuthContext } from "@/lib/rbac/authorize";
import type { PermissionKey } from "@/lib/rbac/permissions";

const IS_PROD = process.env.NODE_ENV === "production";
/** `__Host-` prefix pins the cookie to this exact origin over HTTPS (production only). */
export const SESSION_COOKIE = IS_PROD ? "__Host-bfs_session" : "bfs_session";

/**
 * `persistent` means "Keep me signed in": the cookie survives closing the browser (up to the server-side
 * expiry). Otherwise it is a browser-session cookie. Server-side limits (8 h hard, 30 min idle) apply either way.
 */
export async function setSessionCookie(token: string, expiresAt: Date, persistent = false) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    ...(persistent ? { expires: expiresAt } : {}),
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Client address as reported by the reverse proxy. Configure the proxy to overwrite this header. */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || h.get("x-real-ip"), userAgent: h.get("user-agent") };
}

/** Current admin (or null). Memoized per request. Permissions are re-read from the DB. */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  return authenticateToken(await readSessionToken());
});

/** For pages/layouts: redirects to /login when unauthenticated. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For pages: authenticated + the permission (any scope). Returns null when denied so the page renders 403 UI. */
export async function pageAccess(permission: PermissionKey): Promise<{ ctx: AuthContext; allowed: boolean }> {
  const ctx = await requireAuth();
  return { ctx, allowed: can(ctx, permission) };
}
