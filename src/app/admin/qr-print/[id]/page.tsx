import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { PrintButton } from "@/components/qr/print-button";
import { logAuthorizationDenied, requireAuth } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/rbac/authorize";
import { qrSvg } from "@/lib/qr/generate";
import { getQrForDownload } from "@/server/services/qr";

export const metadata: Metadata = { title: "Print QR code" };

/** Standalone printable sheet (no admin chrome). Same permission and scope checks as downloads. */
export default async function PrintQrPage({ params }: PageProps<"/admin/qr-print/[id]">) {
  const { id } = await params;
  const ctx = await requireAuth();
  if (ctx.mustChangePassword || !can(ctx, "qr.view")) {
    await logAuthorizationDenied("page", "missing qr.view");
    forbidden();
  }

  let qr;
  try {
    qr = await getQrForDownload(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") {
      await logAuthorizationDenied("page", e.message);
      forbidden();
    }
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const svg = await qrSvg(qr.publicCode);

  return (
    <main className="bg-white text-neutral-900 mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-8 text-center print:min-h-0 print:p-0">
      <h1 className="text-3xl font-bold">How was your experience?</h1>
      <p className="text-lg">
        Scan the code with your phone camera to share your feedback. No sign-in needed.
      </p>
      {/* SVG generated server-side from our own public code */}
      <div
        className="w-72 max-w-full [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div>
        <p className="text-xl font-semibold">{qr.location.name}</p>
        <p className="text-sm text-neutral-600">{qr.location.parent ?? qr.location.type}</p>
      </div>
      <p className="break-all font-mono text-xs text-neutral-500">{qr.url}</p>
      <PrintButton />
    </main>
  );
}
