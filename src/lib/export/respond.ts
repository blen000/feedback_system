import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/rbac/authorize";
import { toCsv, toXlsx, type Table } from "./tabular";
import { parseFilters } from "@/lib/validation/feedback";

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  RATE_LIMITED: 429,
};

/**
 * Shared handler for authenticated file exports. The builder runs the permission/scope checks
 * and the audit write; this wrapper only handles sessions, formats and safe headers.
 */
export async function exportResponse(
  request: Request,
  basename: string,
  build: (
    ctx: AuthContext,
    filters: ReturnType<typeof parseFilters>,
    format: "csv" | "xlsx",
  ) => Promise<Table>,
) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  try {
    const ctx = await getAuthContext();
    if (!ctx || ctx.mustChangePassword)
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    const filters = parseFilters(Object.fromEntries(url.searchParams));
    const table = await build(ctx, filters, format);
    const name = `${basename}-${new Date().toISOString().slice(0, 10)}.${format}`;
    const headers = {
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (format === "xlsx") {
      return new NextResponse(new Uint8Array(await toXlsx(table)), {
        headers: {
          ...headers,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });
    }
    return new NextResponse(toCsv(table), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (e) {
    if (e instanceof AppError)
      return NextResponse.json({ error: e.message }, { status: STATUS[e.code] ?? 400 });
    console.error("Export failed", e);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
