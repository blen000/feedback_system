import { prisma } from "@/lib/db/prisma";
import { rateLimited } from "@/lib/errors";

/**
 * Fixed-window counter in Postgres. Returns the new count for the current window.
 * Atomic (single upsert), so concurrent requests cannot slip past the limit.
 */
export async function hit(key: string, windowSeconds: number): Promise<number> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;

  // opportunistic cleanup of old windows
  if (Math.random() < 0.01) {
    void prisma.rateLimitBucket
      .deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } })
      .catch(() => undefined);
  }
  return Number(rows[0].count);
}

/** Throws RATE_LIMITED once `limit` hits have occurred in the window. */
export async function enforceRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  if ((await hit(key, windowSeconds)) > limit) throw rateLimited();
}
