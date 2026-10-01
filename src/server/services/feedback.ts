/**
 * Public feedback submission. Runs with NO authenticated user, so every input is untrusted:
 * the code, the locale, the answers and the optional contact details are all re-validated here.
 */
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { hashIp } from "@/lib/auth/crypto";
import { AppError, invalid } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { validateSubmission } from "@/lib/questionnaire/engine";
import { pick } from "@/lib/questionnaire/types";
import { normalizePhone, PHONE_MESSAGE } from "@/lib/validation/phone";
import { Prisma } from "@/generated/prisma/client";
import { notifyCovering } from "./notifications";
import { resolvePublicCode, type QrResolution } from "./qr";

export const CLOSED_MESSAGE = "This feedback form is currently closed.";
export const UNAVAILABLE_MESSAGE = "This feedback link is no longer available.";
export const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/** Maps resolver failures to customer-safe copy (no internal detail). */
export function messageFor(status: Exclude<QrResolution["status"], "OK">): string {
  return status === "NO_ACTIVE_QUESTIONNAIRE" ? CLOSED_MESSAGE : UNAVAILABLE_MESSAGE;
}

/** Overall ratings at or below this raise an in-app alert for staff covering the location. */
export const LOW_RATING_THRESHOLD = 2;

const bodySchema = z.object({
  answers: z
    .record(z.string().max(64), z.unknown())
    .refine((a) => Object.keys(a).length <= 100, "Too many answers."),
  locale: z.string().max(10).optional(),
  wantsFollowUp: z.boolean().optional(),
  contactPhone: z.string().max(30).nullable().optional(),
});

export interface SubmitMeta {
  ip?: string | null;
}

export async function submitFeedback(publicCode: string, input: unknown, meta: SubmitMeta = {}) {
  const source = hashIp(meta.ip) ?? "unknown";
  // Layered throttling: broad per-source limit, and a tighter one per source per QR code.
  await enforceRateLimit(`submit:ip:${source}`, 30, 600);
  await enforceRateLimit(`submit:code:${publicCode.slice(0, 16)}:${source}`, 6, 600);

  const body = bodySchema.safeParse(input);
  if (!body.success) throw invalid("Please check your answers and try again.");

  const resolved = await resolvePublicCode(publicCode);
  if (resolved.status !== "OK") {
    throw new AppError(
      messageFor(resolved.status),
      resolved.status === "NO_ACTIVE_QUESTIONNAIRE" ? "CONFLICT" : "NOT_FOUND",
    );
  }
  const { definition, versionId, questionnaireId } = resolved.questionnaire;

  const result = validateSubmission(definition, body.data.answers);
  if (!result.ok)
    throw invalid(
      "Please check your answers and try again.",
      Object.fromEntries(Object.entries(result.errors).map(([k, v]) => [k, [v]])),
    );

  // Contact details exist only when the questionnaire asks for them and the customer opted in.
  let wantsFollowUp = false;
  let contactPhone: string | null = null;
  if (definition.collectContact && body.data.wantsFollowUp) {
    const phone = normalizePhone(body.data.contactPhone ?? "");
    if (!phone) throw invalid("Please check your answers and try again.", { _phone: [PHONE_MESSAGE] });
    wantsFollowUp = true;
    contactPhone = phone;
  }

  const locale =
    body.data.locale && definition.locales.includes(body.data.locale)
      ? body.data.locale
      : definition.defaultLocale;

  const submission = await prisma.$transaction(async (tx) => {
    const sub = await tx.feedbackSubmission.create({
      data: {
        questionnaireId,
        versionId,
        qrCodeId: resolved.qrCodeId,
        districtId: resolved.districtId,
        branchId: resolved.branchId,
        departmentId: resolved.departmentId,
        locale,
        overallRating: result.overallRating,
        sentiment: result.sentiment,
        wantsFollowUp,
        contactPhone,
        ipHash: hashIp(meta.ip),
      },
    });
    await tx.feedbackAnswer.createMany({
      data: result.answers.map((a) => ({
        submissionId: sub.id,
        questionRef: a.questionRef,
        questionType: a.questionType,
        valueText: a.valueText,
        valueNumber: a.valueNumber,
        valueOptions: a.valueOptions,
      })),
    });
    return sub;
  });

  // Notifications are best-effort: a failure must never lose or fail the customer's feedback.
  void raiseNotifications(
    submission.id,
    resolved,
    result.overallRating,
    wantsFollowUp,
    pick(definition.title, definition.defaultLocale),
  ).catch((e) => console.error("Notification failed", e));

  return { ok: true as const };
}

async function raiseNotifications(
  submissionId: string,
  resolved: Extract<QrResolution, { status: "OK" }>,
  rating: number | null,
  wantsFollowUp: boolean,
  title: string,
) {
  const location = {
    districtId: resolved.districtId,
    branchId: resolved.branchId,
    departmentId: resolved.departmentId,
  };
  const where = resolved.location.name;
  if (rating !== null && rating <= LOW_RATING_THRESHOLD) {
    await notifyCovering({
      permission: "feedback.view",
      location,
      type: "LOW_RATING",
      title: `Low rating at ${where}`,
      body: `A customer gave ${rating.toFixed(1)} / 5 on “${title}”.`,
      data: { submissionId } as Prisma.InputJsonValue,
    });
  }
  if (wantsFollowUp) {
    await notifyCovering({
      permission: "feedback.view",
      location,
      type: "FOLLOW_UP_REQUESTED",
      title: `Follow-up requested at ${where}`,
      body: "A customer asked to be contacted about their feedback.",
      data: { submissionId } as Prisma.InputJsonValue,
    });
  }
}
