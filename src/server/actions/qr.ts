"use server";

import { runAction } from "./helpers";
import * as qr from "@/server/services/qr";

const PAGE = "/admin/qr-codes";

export async function createQrAction(input: unknown) {
  return runAction((ctx) => qr.createQRCode(ctx, input), { revalidate: [PAGE], message: "QR code created." });
}
export async function updateQrAction(id: string, input: unknown) {
  return runAction((ctx) => qr.updateQRCode(ctx, id, input), {
    revalidate: [PAGE],
    message: "QR code updated.",
  });
}
export async function regenerateQrAction(id: string) {
  return runAction((ctx) => qr.regenerateQRCode(ctx, id), {
    revalidate: [PAGE],
    message: "New code issued. The previously printed QR no longer works.",
  });
}
export async function deleteQrAction(id: string) {
  return runAction((ctx) => qr.deleteQRCode(ctx, id), { revalidate: [PAGE], message: "QR code deleted." });
}
