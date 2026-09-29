"use server";

import { runAction } from "./helpers";
import { deleteFeedback } from "@/server/services/feedback-admin";
import { forwardFeedback, listForwardRecipients } from "@/server/services/forwards";
import { markAllRead } from "@/server/services/notifications";

export async function deleteFeedbackAction(id: string) {
  return runAction((ctx) => deleteFeedback(ctx, id), {
    revalidate: ["/admin/feedback", "/admin/dashboard"],
    message: "Feedback deleted.",
  });
}

export async function forwardFeedbackAction(feedbackId: string, input: unknown) {
  return runAction((ctx) => forwardFeedback(ctx, feedbackId, input), {
    revalidate: ["/admin/feedback"],
    message: "Feedback forwarded.",
  });
}

export async function listForwardRecipientsAction() {
  return runAction((ctx) => listForwardRecipients(ctx));
}

export async function markNotificationsReadAction() {
  return runAction((ctx) => markAllRead(ctx), { revalidate: ["/admin/dashboard"] });
}
