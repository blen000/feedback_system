import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
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
    sameSite: "strict", // the cookie is never sent on cross-site requests, which also closes CSRF via top-level navigation
    path: "/",
    ...(persistent ? { expires: expiresAt } : {}),
  });
}

/**
 * Remembers an active login lockout in the browser so the countdown survives a refresh or leaving the
 * page. This is display state only: the lock itself is enforced in the database (login-throttle.ts),
 * so deleting or editing this cookie never grants another attempt.
 */
const LOCK_COOKIE = IS_PROD ? "__Host-bfs_login_lock" : "bfs_login_lock";

export async function setLoginLockCookie(seconds: number) {
  (await cookies()).set(LOCK_COOKIE, String(Date.now() + seconds * 1000), {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "strict",
    path: "/",
    maxAge: seconds,
  });
}

export async function clearLoginLockCookie() {
  (await cookies()).delete(LOCK_COOKIE);
}

/** Whole seconds of lockout left according to the cookie (0 when none). */
export async function loginLockSecondsLeft(): Promise<number> {
  const until = Number((await cookies()).get(LOCK_COOKIE)?.value);
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
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

/** Records that a signed-in user was refused. Never throws: auditing must not change the response. */
export async function logAuthorizationDenied(kind: string, detail: string): Promise<void> {
  try {
    const ctx = await getAuthContext();
    await writeAudit({
      actorId: ctx?.userId ?? null,
      action: "AUTHORIZATION_DENIED",
      resource: kind,
      metadata: { detail },
      ip: (await requestMeta()).ip,
    });
  } catch {
    /* ignore */
  }
}

/** For pages: authenticated + the permission (any scope). Anyone else gets a real HTTP 403 (and an audit entry). */
export async function pageAccess(permission: PermissionKey): Promise<{ ctx: AuthContext }> {
  const ctx = await requireAuth();
  if (!can(ctx, permission)) {
    await logAuthorizationDenied("page", `missing ${permission}`);
    forbidden();
  }
  return { ctx };
}
