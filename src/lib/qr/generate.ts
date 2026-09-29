import { randomInt } from "node:crypto";
import QRCode from "qrcode";
import { env } from "@/lib/env";

/** No 0/O/1/I/L: codes stay readable when printed or typed. 32 symbols × 8 chars = 40 bits of randomness. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PUBLIC_CODE_LENGTH = 8;
export const PUBLIC_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

/** Cryptographically random, non-sequential public identifier. */
export function generatePublicCode(): string {
  let out = "";
  for (let i = 0; i < PUBLIC_CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function publicUrl(code: string): string {
  return `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/f/${code}`;
}

// High error correction so codes survive printing and wear.
const OPTIONS = { errorCorrectionLevel: "H" as const, margin: 2 };

export function qrSvg(code: string): Promise<string> {
  return QRCode.toString(publicUrl(code), { ...OPTIONS, type: "svg" });
}

export function qrPng(code: string, width = 1024): Promise<Buffer> {
  return QRCode.toBuffer(publicUrl(code), { ...OPTIONS, type: "png", width });
}

export async function qrSvgDataUri(code: string): Promise<string> {
  return `data:image/svg+xml;base64,${Buffer.from(await qrSvg(code)).toString("base64")}`;
}
