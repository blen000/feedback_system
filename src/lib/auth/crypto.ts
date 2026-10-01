import { createHmac, randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";

const BCRYPT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Valid bcrypt hash of a random value; compared against when the user does not exist (timing parity). */
export const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString("hex"), BCRYPT_ROUNDS);

/** Opaque 256-bit session token. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Keyed hash so a database leak alone cannot be replayed as session cookies. */
export function hmac(value: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(value).digest("hex");
}

export function hashIp(ip: string | null | undefined): string | null {
  return ip ? hmac(`ip:${ip}`).slice(0, 32) : null;
}

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SPECIAL = "!@#$%^&*-_+=?";

const pick = (set: string) => set[randomInt(set.length)];

/** Random temporary password that always satisfies the password policy (upper, lower, digit, special). */
export function generateTemporaryPassword(length = 16): string {
  const all = UPPER + LOWER + DIGITS + SPECIAL;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates with a CSPRNG so the guaranteed characters are not always at the front
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
