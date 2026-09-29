import { headers } from "next/headers";
import { BANK_NAME, BrandMark } from "@/components/brand/brand";
import { PublicFeedback } from "@/components/feedback/public-feedback";
import { requestMeta } from "@/lib/auth/session";
import { resolvePublicCode, recordScan } from "@/server/services/qr";
import { messageFor } from "@/server/services/feedback";

function Shell({ children, location }: { children: React.ReactNode; location?: string }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16">
      <header className="flex items-center gap-3 py-5">
        <BrandMark className="size-11" />
        <div className="leading-tight">
          <p className="font-semibold">{BANK_NAME}</p>
          {location ? <p className="text-sm text-muted-foreground">{location}</p> : null}
        </div>
      </header>
      {children}
    </main>
  );
}

export default async function PublicFeedbackPage({ params, searchParams }: PageProps<"/f/[publicCode]">) {
  const { publicCode } = await params;
  const sp = await searchParams;
  await headers(); // opt into dynamic rendering: state changes whenever staff change a questionnaire

  const resolved = await resolvePublicCode(publicCode);
  if (resolved.status !== "OK") {
    return (
      <Shell>
        <div role="alert" className="rounded-xl border bg-card p-8 text-center">
          <p className="text-xl font-medium">{messageFor(resolved.status)}</p>
          <p className="mt-2 text-muted-foreground">Please ask a member of staff for help.</p>
        </div>
      </Shell>
    );
  }

  // A scan is a page open; failing to count it must never block the customer.
  await recordScan(resolved.qrCodeId, (await requestMeta()).ip).catch(() => undefined);

  const kiosk = sp.kiosk === "1";
  return (
    <Shell location={resolved.location.name}>
      <PublicFeedback code={publicCode} definition={resolved.questionnaire.definition} kiosk={kiosk} />
    </Shell>
  );
}
