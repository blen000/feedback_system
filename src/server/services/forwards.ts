/**
 * Forwarding: a person who can see a feedback record may send it on to a colleague, with an optional note.
 * There is no assignment or status; the recipient just gets the record in "Forwarded to me" plus an
 * in-app notification, and the record is marked read when they open it.
 *
 * Access rules:
 *  - the sender needs feedback.forward AND must be able to view the record (scope is enforced in the query)
 *  - the recipient must be an active user who already holds feedback.view
 *  - a forward shares only that record; contact details stay hidden unless the recipient holds
 *    feedback.view_contact over its location (see getFeedbackDetail)
 */
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { forbidden, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/rbac/authorize";
import { parse } from "@/lib/validation/parse";
import type { Prisma } from "@/generated/prisma/client";
import { feedbackWhere } from "./feedback-admin";

const forwardSchema = z.object({
  toUserId: z.string().uuid("Choose who to forward this to."),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional().nullable(),
});

/** Active users (other than the sender) who hold feedback.view, i.e. people who use the Feedback area. */
async function eligibleRecipients(excludeUserId: string) {
  return prisma.user.findMany({
    where: {
      id: { not: excludeUserId },
      status: "ACTIVE",
      deletedAt: null,
      roles: {
        some: { role: { deletedAt: null, permissions: { some: { permission: { key: "feedback.view" } } } } },
      },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

/** Options for the "Forward" dialog. Names and emails only. */
export async function listForwardRecipients(ctx: AuthContext) {
  requirePermission(ctx, "feedback.forward");
  return eligibleRecipients(ctx.userId);
}

export async function forwardFeedback(ctx: AuthContext, feedbackId: string, input: unknown) {
  const forwardScope = requirePermission(ctx, "feedback.forward");
  const viewScope = requirePermission(ctx, "feedback.view");
  const data = parse(forwardSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(feedbackId)) throw notFound("Feedback");
  if (data.toUserId === ctx.userId) throw forbidden("You cannot forward feedback to yourself.");

  // the record must be inside BOTH the sender's view and forward scopes
  const fb = await prisma.feedbackSubmission.findFirst({
    where: { AND: [{ id: feedbackId }, feedbackWhere(viewScope, {}), feedbackWhere(forwardScope, {})] },
    select: {
      id: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
      district: { select: { name: true } },
    },
  });
  if (!fb) throw notFound("Feedback");

  const recipient = (await eligibleRecipients(ctx.userId)).find((u) => u.id === data.toUserId);
  if (!recipient) throw forbidden("That person cannot receive forwarded feedback.");

  // Forwarding again to the same person refreshes the note and marks it unread.
  const row = await prisma.feedbackForward.upsert({
    where: { feedbackId_toUserId: { feedbackId, toUserId: data.toUserId } },
    create: { feedbackId, fromUserId: ctx.userId, toUserId: data.toUserId, note: data.note || null },
    update: { fromUserId: ctx.userId, note: data.note || null, readAt: null, createdAt: new Date() },
  });

  const where = fb.branch?.name ?? fb.department?.name ?? fb.district?.name ?? "a location";
  await prisma.notification.create({
    data: {
      userId: data.toUserId,
      type: "FEEDBACK_FORWARDED",
      title: `${ctx.name} forwarded feedback from ${where}`,
      body: data.note || null,
      data: { submissionId: feedbackId, forwardId: row.id } as Prisma.InputJsonValue,
    },
  });
  await writeAudit({
    actorId: ctx.userId,
    action: "FEEDBACK_FORWARDED",
    resource: "Feedback",
    resourceId: feedbackId,
    metadata: { toUserId: data.toUserId, hasNote: !!data.note },
  });
}

/** The current user's inbox of forwarded feedback (newest first). */
export async function listForwardedToMe(ctx: AuthContext) {
  requirePermission(ctx, "feedback.view");
  const rows = await prisma.feedbackForward.findMany({
    where: { toUserId: ctx.userId, feedback: { deletedAt: null } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      from: { select: { name: true } },
      feedback: {
        select: {
          id: true,
          submittedAt: true,
          overallRating: true,
          sentiment: true,
          branch: { select: { name: true } },
          department: { select: { name: true } },
          district: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    feedbackId: r.feedback.id,
    from: r.from.name,
    note: r.note,
    read: !!r.readAt,
    forwardedAt: r.createdAt,
    submittedAt: r.feedback.submittedAt,
    location: r.feedback.branch?.name ?? r.feedback.department?.name ?? r.feedback.district?.name ?? "—",
    overallRating: r.feedback.overallRating,
    sentiment: r.feedback.sentiment,
  }));
}

export async function unreadForwardCount(ctx: AuthContext) {
  return prisma.feedbackForward.count({
    where: { toUserId: ctx.userId, readAt: null, feedback: { deletedAt: null } },
  });
}
