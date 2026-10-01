import { prisma } from "@/lib/db/prisma";
import { hashIp } from "@/lib/auth/crypto";
import { env } from "@/lib/env";
import { emailEnabled, sendMail } from "@/lib/mail/mailer";
import { securityAlertEmail } from "@/lib/mail/templates";
import type { AuditSeverity, Prisma } from "@/generated/prisma/client";

export const AUDIT_ACTIONS = [
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "ACCOUNT_LOCKED",
  "AUTHORIZATION_DENIED",
  "REAUTH_FAILED",
  "PASSWORD_CHANGED",
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DEACTIVATED",
  "USER_ACTIVATED",
  "USER_PASSWORD_RESET",
  "USER_INVITED",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_COMPLETED",
  "USER_ROLES_CHANGED",
  "ROLE_CREATED",
  "ROLE_UPDATED",
  "ROLE_DELETED",
  "DISTRICT_CREATED",
  "DISTRICT_UPDATED",
  "DISTRICT_DELETED",
  "BRANCH_CREATED",
  "BRANCH_UPDATED",
  "BRANCH_DELETED",
  "DEPARTMENT_CREATED",
  "DEPARTMENT_UPDATED",
  "DEPARTMENT_DELETED",
  "QUESTION_CREATED",
  "QUESTION_UPDATED",
  "QUESTION_DELETED",
  "QUESTIONNAIRE_CREATED",
  "QUESTIONNAIRE_UPDATED",
  "QUESTIONNAIRE_PUBLISHED",
  "QUESTIONNAIRE_ACTIVATED",
  "QUESTIONNAIRE_REOPENED",
  "QUESTIONNAIRE_DELETED",
  "QUESTIONNAIRE_ASSIGNED",
  "QUESTIONNAIRE_PAUSED",
  "QUESTIONNAIRE_CLOSED",
  "QR_CREATED",
  "QR_UPDATED",
  "QR_DEACTIVATED",
  "QR_DELETED",
  "FEEDBACK_EXPORTED",
  "FEEDBACK_DELETED",
  "FEEDBACK_FORWARDED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Default severity per action (everything else is INFO). HIGH and CRITICAL entries raise an alert:
 * a structured log line plus an email to the security contacts.
 */
const SEVERITY: Partial<Record<AuditAction, AuditSeverity>> = {
  LOGIN_FAILED: "WARNING",
  AUTHORIZATION_DENIED: "WARNING",
  USER_DEACTIVATED: "WARNING",
  FEEDBACK_DELETED: "WARNING",
  FEEDBACK_EXPORTED: "WARNING",
  QUESTIONNAIRE_DELETED: "WARNING",
  QR_DELETED: "WARNING",
  ACCOUNT_LOCKED: "WARNING", // a 30-second lock is routine; repeated ones show up in the log
  REAUTH_FAILED: "HIGH",
  USER_PASSWORD_RESET: "HIGH",
  USER_ROLES_CHANGED: "HIGH",
  ROLE_UPDATED: "HIGH",
  ROLE_DELETED: "HIGH",
};

export const severityOf = (action: AuditAction): AuditSeverity => SEVERITY[action] ?? "INFO";
const ALERTING: AuditSeverity[] = ["HIGH", "CRITICAL"];

const SENSITIVE_KEY = /pass(word)?|secret|token|hash/i;

/** Recursively drops secret-looking keys so they can never reach the audit table. */
export function sanitizeMetadata(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((v) => sanitizeMetadata(v) ?? null) as Prisma.InputJsonValue;
  if (typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) continue;
      out[k] = sanitizeMetadata(v) ?? null;
    }
    return out;
  }
  return value as Prisma.InputJsonValue;
}

export interface AuditEntry {
  actorId?: string | null;
  action: AuditAction;
  resource: string;
  resourceId?: string | null;
  metadata?: unknown;
  /** Omit to use the current request's address. */
  ip?: string | null;
  /** Overrides the default for the action. */
  severity?: AuditSeverity;
}

/** Client address of the request being served, when there is one (scripts and tests have none). */
async function ambientIp(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const severity = entry.severity ?? severityOf(entry.action);
  if (entry.ip === undefined) entry = { ...entry, ip: await ambientIp() };
  await prisma.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      metadata: sanitizeMetadata(entry.metadata),
      ipHash: hashIp(entry.ip),
      ip: entry.ip?.slice(0, 64) ?? null,
      severity,
    },
  });
  if (ALERTING.includes(severity)) void raiseAlert(entry, severity).catch(() => undefined);
}

async function alertRecipients(): Promise<string[]> {
  const configured = env().SECURITY_ALERT_EMAILS;
  if (configured)
    return configured
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  const admins = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      roles: { some: { role: { key: "SUPER_ADMIN", deletedAt: null } } },
    },
    select: { email: true },
    take: 20,
  });
  return admins.map((a) => a.email);
}

/** Never throws: an alerting failure must not undo or block the action that triggered it. */
async function raiseAlert(entry: AuditEntry, severity: AuditSeverity): Promise<void> {
  const when = new Date().toISOString();
  // one structured line for log shippers / SIEM rules; metadata is sanitized, no secrets
  console.warn(
    JSON.stringify({
      event: "security-alert",
      severity,
      action: entry.action,
      actorId: entry.actorId ?? null,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      ip: entry.ip ?? null,
      at: when,
    }),
  );
  if (!emailEnabled()) return;
  const detail = JSON.stringify(sanitizeMetadata(entry.metadata) ?? {});
  for (const to of await alertRecipients()) {
    await sendMail(
      securityAlertEmail({
        to,
        severity,
        action: entry.action,
        actorId: entry.actorId ?? null,
        resource: `${entry.resource}${entry.resourceId ? ` ${entry.resourceId}` : ""}`,
        ip: entry.ip ?? null,
        at: when,
        detail,
      }),
    ).catch(() => undefined);
  }
}
