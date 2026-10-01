import type { Metadata } from "next";
import { DownloadIcon } from "lucide-react";
import { KpiRow, OverviewCharts } from "@/components/charts/overview-charts";
import { ChartCard, VerticalBars } from "@/components/charts/charts";
import { FilterBar, filtersToQuery } from "@/components/feedback/filter-bar";
import { PrintButton } from "@/components/qr/print-button";
import { EmptyState, PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { logAuthorizationDenied, pageAccess } from "@/lib/auth/session";
import { forbidden } from "next/navigation";
import { can } from "@/lib/rbac/authorize";
import { parseFilters } from "@/lib/validation/feedback";
import { getOverview, getQuestionReport, withDefaultRange } from "@/server/services/analytics";
import { feedbackFilterOptions } from "@/server/services/feedback-admin";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const { ctx } = await pageAccess("reports.view");
  if (!can(ctx, "feedback.view")) {
    await logAuthorizationDenied("page", "missing feedback.view");
    forbidden();
  }

  const filters = parseFilters(await searchParams);
  const ranged = withDefaultRange(filters);
  const [options, overview, questionReport] = await Promise.all([
    feedbackFilterOptions(ctx),
    getOverview(ctx, filters),
    filters.questionnaireId ? getQuestionReport(ctx, filters) : null,
  ]);
  const query = filtersToQuery(ranged);
  const canExport = can(ctx, "reports.export");

  return (
    <>
      <PageHeader
        title="Reports"
        description="Response volume, ratings and question-level results for the period you choose."
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {canExport ? (
              <>
                <Button
                  variant="outline"
                  render={<a href={`/admin/reports/export?${query}&format=csv`} download />}
                >
                  <DownloadIcon /> Summary CSV
                </Button>
                <Button
                  variant="outline"
                  render={<a href={`/admin/reports/export?${query}&format=xlsx`} download />}
                >
                  <DownloadIcon /> Summary Excel
                </Button>
              </>
            ) : null}
            <PrintButton label="Print / save as PDF" />
          </div>
        }
      />
      <div className="print:hidden">
        <FilterBar
          action="/admin/reports"
          filters={ranged}
          options={options}
          show={{ search: false, rating: false, answer: false }}
        />
      </div>
      <p className="hidden text-sm print:block">
        Period {overview.range.from} to {overview.range.to}
      </p>

      <KpiRow o={overview} />
      <OverviewCharts o={overview} />

      <h2 className="text-lg font-semibold">Question results</h2>
      {!questionReport ? (
        <EmptyState
          title="Choose a questionnaire"
          description="Select a questionnaire above and apply to see results for each question."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {questionReport.questions.map((q) => (
            <ChartCard
              key={q.ref}
              title={q.question}
              description={`${q.answered.toLocaleString()} of ${questionReport.total.toLocaleString()} answered${q.average !== undefined && q.average !== null ? ` · average ${q.average}` : ""}`}
              empty={q.answered === 0 || !q.distribution}
              table={{
                columns: ["Answer", "Responses"],
                rows: (q.distribution ?? []).map((d) => [d.label, d.count]),
              }}
            >
              <VerticalBars
                data={(q.distribution ?? []).map((d) => ({ name: d.label, value: d.count }))}
                unit="responses"
              />
            </ChartCard>
          ))}
        </div>
      )}
    </>
  );
}
