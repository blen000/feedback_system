import { exportResponse } from "@/lib/export/respond";
import { exportReportTable } from "@/server/services/analytics";

export async function GET(request: Request) {
  return exportResponse(request, "report", (ctx, filters, format) => exportReportTable(ctx, filters, format));
}
