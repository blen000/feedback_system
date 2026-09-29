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

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Random temporary password (shown once to the administrator). */
export function generateTemporaryPassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  // guarantee letter+digit so it satisfies the password policy
  return `${out.slice(0, length - 2)}${randomInt(2, 10)}${randomInt(2, 10)}`;
}
