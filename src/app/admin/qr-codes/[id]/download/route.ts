import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { qrPng, qrSvg } from "@/lib/qr/generate";
import { getQrForDownload } from "@/server/services/qr";

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404 };

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "qr"
  );
}

/** Authenticated download. Permission and organizational scope are checked on every request. */
export async function GET(request: Request, ctx: RouteContext<"/admin/qr-codes/[id]/download">) {
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format") === "svg" ? "svg" : "png";
  try {
    const auth = await getAuthContext();
    if (!auth || auth.mustChangePassword)
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    const qr = await getQrForDownload(auth, id);
    const name = `qr-${slug(qr.label)}-${qr.publicCode}.${format}`;
    const headers = {
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (format === "svg") {
      return new NextResponse(await qrSvg(qr.publicCode), {
        headers: { ...headers, "Content-Type": "image/svg+xml" },
      });
    }
    return new NextResponse(new Uint8Array(await qrPng(qr.publicCode)), {
      headers: { ...headers, "Content-Type": "image/png" },
    });
  } catch (e) {
    if (e instanceof AppError)
      return NextResponse.json({ error: e.message }, { status: STATUS[e.code] ?? 400 });
    console.error("QR download failed", e);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
