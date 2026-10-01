import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { QrManager } from "@/components/qr/qr-manager";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { listQRCodes, listQrLocations } from "@/server/services/qr";

export const metadata: Metadata = { title: "QR codes" };

export default async function QrCodesPage() {
  const { ctx } = await pageAccess("qr.view");
  const [rows, locations] = await Promise.all([
    listQRCodes(ctx),
    can(ctx, "qr.create") ? listQrLocations(ctx) : null,
  ]);
  return (
    <>
      <PageHeader
        title="QR codes"
        description="Each code points to a location. Customers see whichever questionnaire is active there."
      />
      <QrManager
        rows={rows}
        locations={locations}
        perms={{
          create: can(ctx, "qr.create"),
          update: can(ctx, "qr.update"),
          delete: can(ctx, "qr.delete"),
        }}
      />
    </>
  );
}
