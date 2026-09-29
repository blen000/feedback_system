/**
 * One-time password links: "forgot password" (RESET) and "set your password" invitations (INVITE).
 *  - the raw token exists only in the email; the database keeps an HMAC of it
 *  - tokens are single-use (claimed atomically), expire, and issuing a new one voids older ones
 *  - the forgot-password endpoint answers identically whether or not the account exists
 *  - completing a reset ends every session of that user and clears lockouts
 */
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { generateToken, hashIp, hashPassword, hmac } from "@/lib/auth/crypto";
import { env } from "@/lib/env";
import { AppError, invalid } from "@/lib/errors";
import { emailEnabled, sendMail } from "@/lib/mail/mailer";
import { inviteEmail, resetEmail } from "@/lib/mail/templates";
import { enforceRateLimit } from "@/lib/rate-limit";
import { emailSchema, passwordSchema } from "@/lib/validation/auth";
import { z } from "zod";
import type { TokenPurpose } from "@/generated/prisma/client";
import type { RequestMeta } from "./auth";
import { revokeAllSessions } from "./auth";

export const RESET_MINUTES = 60;
export const INVITE_HOURS = 48;
export const INVALID_LINK = "This link is invalid or has expired.";

const linkFor = (token: string) =>
  `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;

async function issueToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const token = generateToken();
  const ttlMs = purpose === "INVITE" ? INVITE_HOURS * 3600_000 : RESET_MINUTES * 60_000;
  // a fresh link voids any earlier unused one of the same kind
  await prisma.passwordToken.deleteMany({ where: { userId, purpose, usedAt: null } });
  await prisma.passwordToken.create({
    data: { userId, purpose, tokenHash: hmac(`pwd:${token}`), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
}

/** Emails a "set your password" invitation. Returns false (and logs) if delivery failed. */
export async function sendInvite(
  user: { id: string; email: string; name: string },
  actorId: string | null,
): Promise<boolean> {
  const token = await issueToken(user.id, "INVITE");
  try {
    await sendMail(
      inviteEmail({ to: user.email, name: user.name, link: linkFor(token), hours: INVITE_HOURS }),
    );
  } catch {
    return false;
  }
  await writeAudit({
    actorId,
    action: "USER_INVITED",
    resource: "User",
    resourceId: user.id,
    metadata: { email: user.email },
  });
  return true;
}

/**
 * "Forgot password". Always resolves the same way so the form cannot be used to discover which
 * emails have accounts. Delivery happens in the background so response time does not differ either.
 */
export async function requestPasswordReset(emailInput: unknown, meta: RequestMeta = {}): Promise<void> {
  const parsed = emailSchema.safeParse(emailInput);
  if (!parsed.success) return; // malformed: same silent answer
  const email = parsed.data;

  await enforceRateLimit(`reset:ip:${hashIp(meta.ip) ?? "unknown"}`, 10, 15 * 60);
  await enforceRateLimit(`reset:email:${hmac(email).slice(0, 24)}`, 3, 15 * 60);
  if (!emailEnabled()) return;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE" || user.deletedAt) return;

  const token = await issueToken(user.id, "RESET");
  await writeAudit({
    actorId: user.id,
    action: "PASSWORD_RESET_REQUESTED",
    resource: "User",
    resourceId: user.id,
    ip: meta.ip,
  });
  void sendMail(
    resetEmail({ to: user.email, name: user.name, link: linkFor(token), minutes: RESET_MINUTES }),
  ).catch(() => undefined);
}

/** What the reset page needs to know about a link. Reveals nothing about the account. */
export async function inspectToken(
  token: unknown,
): Promise<{ valid: false } | { valid: true; purpose: TokenPurpose }> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return { valid: false };
  const row = await prisma.passwordToken.findUnique({
    where: { tokenHash: hmac(`pwd:${token}`) },
    include: { user: true },
  });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return { valid: false };
  if (row.user.status !== "ACTIVE" || row.user.deletedAt) return { valid: false };
  return { valid: true, purpose: row.purpose };
}

const completeSchema = z
  .object({ token: z.string().min(20).max(100), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export async function completePasswordReset(input: unknown, meta: RequestMeta = {}): Promise<void> {
  await enforceRateLimit(`reset-complete:ip:${hashIp(meta.ip) ?? "unknown"}`, 20, 15 * 60);
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[i.path.join(".") || "_"] ??= []).push(i.message);
    if (fieldErrors.token) throw new AppError(INVALID_LINK, "VALIDATION");
    throw invalid("Please correct the highlighted fields.", fieldErrors);
  }
  const { token, newPassword } = parsed.data;

  const info = await inspectToken(token);
  if (!info.valid) throw new AppError(INVALID_LINK, "VALIDATION");

  // Claim the token atomically: of two simultaneous submissions, only one succeeds.
  const hash = hmac(`pwd:${token}`);
  const claimed = await prisma.passwordToken.updateMany({
    where: { tokenHash: hash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw new AppError(INVALID_LINK, "VALIDATION");

  const row = await prisma.passwordToken.findUniqueOrThrow({ where: { tokenHash: hash } });
  await prisma.user.update({
    where: { id: row.userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await prisma.passwordToken.deleteMany({ where: { userId: row.userId, usedAt: null } }); // void any other outstanding links
  await revokeAllSessions(row.userId); // anyone signed in with the old password is signed out
  await writeAudit({
    actorId: row.userId,
    action: "PASSWORD_RESET_COMPLETED",
    resource: "User",
    resourceId: row.userId,
    metadata: { via: row.purpose },
    ip: meta.ip,
  });
}
