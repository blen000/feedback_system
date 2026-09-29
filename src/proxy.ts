import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-bfs_session" : "bfs_session";

/**
 * Optimistic gate only: sends anonymous visitors to /login before rendering.
 * It does NOT authorize — every page, server action and service re-validates the
 * session and permissions against the database.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
