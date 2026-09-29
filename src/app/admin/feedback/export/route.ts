import { exportResponse } from "@/lib/export/respond";
import { exportFeedbackTable } from "@/server/services/feedback-admin";

export async function GET(request: Request) {
  return exportResponse(request, "feedback", (ctx, filters, format) =>
    exportFeedbackTable(ctx, filters, format),
  );
}
