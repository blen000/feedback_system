import { prisma } from "@/lib/db/prisma";
import { hashIp } from "@/lib/auth/crypto";
import type { Prisma } from "@/generated/prisma/client";

export const AUDIT_ACTIONS = [
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
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
  ip?: string | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      metadata: sanitizeMetadata(entry.metadata),
      ipHash: hashIp(entry.ip),
    },
  });
}
