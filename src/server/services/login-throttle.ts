/**
 * Login attempt limiter: at most MAX_LOGIN_ATTEMPTS password attempts, then the login is locked for
 * exactly LOCKOUT_SECONDS. Keyed by the (hashed) email address and kept in Postgres, so
 *  - the state survives restarts, page refreshes and new browsers, and every app instance agrees,
 *  - an address that has no account behaves identically (no way to tell whether it exists).
 *
 * An attempt is *reserved* with one atomic statement BEFORE the password is checked. Parallel requests
 * therefore cannot slip extra guesses past the limit: attempts beyond the 5th are never verified.
 */
import { prisma } from "@/lib/db/prisma";
import { hmac } from "@/lib/auth/crypto";

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 30;

const keyFor = (email: string) => hmac(`login-throttle:${email}`);

export type Reservation = { allowed: true; attempt: number } | { allowed: false; retryAfterSeconds: number };

const remaining = (until: Date, now: Date) =>
  Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));

/**
 * Counts one attempt for `email`. Returns allowed=false (without counting) while the lock is active.
 * A lock that has expired starts a fresh window with this attempt as number 1.
 */
export async function reserveAttempt(email: string, now = new Date()): Promise<Reservation> {
  const lockUntil = new Date(now.getTime() + LOCKOUT_SECONDS * 1000);
  const rows = await prisma.$queryRaw<{ attempts: number; lockedUntil: Date | null }[]>`
    INSERT INTO "LoginThrottle" AS t ("key", "attempts", "lockedUntil", "updatedAt")
    VALUES (${keyFor(email)}, 1, NULL, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE
        WHEN t."lockedUntil" IS NOT NULL AND t."lockedUntil" > ${now} THEN t."attempts"   -- locked: unchanged
        WHEN t."lockedUntil" IS NOT NULL THEN 1                                           -- lock over: new window
        ELSE t."attempts" + 1
      END,
      "lockedUntil" = CASE
        WHEN t."lockedUntil" IS NOT NULL AND t."lockedUntil" > ${now} THEN t."lockedUntil"
        WHEN t."lockedUntil" IS NOT NULL THEN NULL
        WHEN t."attempts" + 1 > ${MAX_LOGIN_ATTEMPTS} THEN ${lockUntil}::timestamp         -- 6th request while the 5th is in flight
        ELSE NULL
      END,
      "updatedAt" = ${now}
    RETURNING "attempts", "lockedUntil"`;
  const row = rows[0];
  if (row.lockedUntil && row.lockedUntil > now)
    return { allowed: false, retryAfterSeconds: remaining(row.lockedUntil, now) };
  return { allowed: true, attempt: Number(row.attempts) };
}

/**
 * Called when a reserved attempt failed. On the 5th failure the lock starts now and lasts exactly
 * LOCKOUT_SECONDS. Returns the lock length in seconds, or null when attempts remain.
 */
export async function recordFailure(email: string, attempt: number): Promise<number | null> {
  if (attempt < MAX_LOGIN_ATTEMPTS) return null;
  const now = new Date();
  const until = new Date(now.getTime() + LOCKOUT_SECONDS * 1000);
  await prisma.$executeRaw`
    UPDATE "LoginThrottle" SET "lockedUntil" = ${until}, "updatedAt" = ${now}
    WHERE "key" = ${keyFor(email)} AND "lockedUntil" IS NULL`;
  return LOCKOUT_SECONDS;
}

/** Successful sign-in, or an administrator unlocking the account: forget earlier failures. */
export async function clearLoginThrottle(email: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { key: keyFor(email) } });
  if (Math.random() < 0.01) {
    void prisma.loginThrottle
      .deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } })
      .catch(() => undefined);
  }
}

export const throttleKeyFor = keyFor;
