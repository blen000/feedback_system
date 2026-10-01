import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
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

// High error correction so codes survive printing and wear — and the centre logo.
const OPTIONS = { errorCorrectionLevel: "H" as const, margin: 2 };

/**
 * Centre logo. Level "H" restores up to 30% of the symbol; the logo box (white pad included) spans
 * ~22% of the width, i.e. ~5% of the modules, and stays clear of the finder patterns.
 */
const LOGO_PATH = path.join(process.cwd(), "src/app/icon.png");
const LOGO_RATIO = 0.22;
const LOGO_PAD = 0.5; // white padding around the icon, in modules

let logo: Promise<Buffer> | undefined;
function logoPng(): Promise<Buffer> {
  logo ??= readFile(LOGO_PATH).catch((e) => {
    logo = undefined;
    throw e;
  });
  return logo;
}

/** Logo box in module units, snapped to the module grid and centred (QR sizes are odd, so is the box). */
function logoBox(data: string) {
  const size = QRCode.create(data, { errorCorrectionLevel: OPTIONS.errorCorrectionLevel }).modules.size;
  let box = Math.round(size * LOGO_RATIO);
  if ((size - box) % 2) box++;
  return { total: size + OPTIONS.margin * 2, start: OPTIONS.margin + (size - box) / 2, box };
}

export async function qrSvg(code: string): Promise<string> {
  const url = publicUrl(code);
  const [svg, icon] = await Promise.all([QRCode.toString(url, { ...OPTIONS, type: "svg" }), logoPng()]);
  const { start, box } = logoBox(url);
  const overlay =
    `<rect x="${start}" y="${start}" width="${box}" height="${box}" fill="#ffffff"/>` +
    `<image href="data:image/png;base64,${icon.toString("base64")}" x="${start + LOGO_PAD}" y="${start + LOGO_PAD}"` +
    ` width="${box - 2 * LOGO_PAD}" height="${box - 2 * LOGO_PAD}" shape-rendering="auto"/>`;
  return svg.replace("</svg>", `${overlay}</svg>`);
}

export async function qrPng(code: string, width = 1024): Promise<Buffer> {
  const url = publicUrl(code);
  const [png, icon] = await Promise.all([QRCode.toBuffer(url, { ...OPTIONS, type: "png", width }), logoPng()]);
  const { total, start, box } = logoBox(url);
  const scale = (await sharp(png).metadata()).width / total;
  // floor/ceil so the pad fully covers the modules underneath
  const from = Math.floor(start * scale);
  const padSize = Math.ceil((start + box) * scale) - from;
  const inset = Math.round(LOGO_PAD * scale);
  const iconSize = padSize - 2 * inset;
  return sharp(png)
    .composite([
      { input: { create: { width: padSize, height: padSize, channels: 4, background: "#ffffff" } }, left: from, top: from },
      { input: await sharp(icon).resize(iconSize, iconSize).png().toBuffer(), left: from + inset, top: from + inset },
    ])
    .png()
    .toBuffer();
}

export async function qrSvgDataUri(code: string): Promise<string> {
  return `data:image/svg+xml;base64,${Buffer.from(await qrSvg(code)).toString("base64")}`;
}
