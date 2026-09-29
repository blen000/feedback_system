import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon } from "lucide-react";
import { FilterBar, filtersToQuery } from "@/components/feedback/filter-bar";
import { SentimentBadge, Stars } from "@/components/feedback/rating";
import { AccessDenied, EmptyState, PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { parseFilters } from "@/lib/validation/feedback";
import { answerFilterOptions, feedbackFilterOptions, listFeedback } from "@/server/services/feedback-admin";

export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbackPage({ searchParams }: PageProps<"/admin/feedback">) {
  const { ctx, allowed } = await pageAccess("feedback.view");
  if (!allowed) return <AccessDenied />;

  const filters = parseFilters(await searchParams);
  const [options, result, answerQuestions] = await Promise.all([
    feedbackFilterOptions(ctx),
    listFeedback(ctx, filters),
    filters.questionnaireId ? answerFilterOptions(ctx, filters.questionnaireId) : [],
  ]);
  const pages = Math.max(Math.ceil(result.total / result.pageSize), 1);
  const qs = (page: number) => filtersToQuery(filters, { page: String(page) });
  const exportBase = filtersToQuery(filters);

  return (
    <>
      <PageHeader
        title="Feedback"
        description="Responses from your locations. Filters are kept in the address so you can share a view."
        actions={
          can(ctx, "feedback.export") ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                render={<a href={`/admin/feedback/export?${exportBase}&format=csv`} download />}
              >
                <DownloadIcon /> CSV
              </Button>
              <Button
                variant="outline"
                render={<a href={`/admin/feedback/export?${exportBase}&format=xlsx`} download />}
              >
                <DownloadIcon /> Excel
              </Button>
            </div>
          ) : null
        }
      />
      <FilterBar
        action="/admin/feedback"
        filters={filters}
        options={options}
        answerQuestions={answerQuestions}
      />

      {result.rows.length === 0 ? (
        <EmptyState
          title="No feedback found"
          description="Try widening the date range or clearing filters."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Submitted</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Questionnaire</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Sentiment</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {r.submittedAt.toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Africa/Addis_Ababa",
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{r.location.label}</div>
                    {r.location.district && r.location.district !== r.location.label ? (
                      <div className="text-xs text-muted-foreground">{r.location.district}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-56 truncate">{r.questionnaire}</TableCell>
                  <TableCell>
                    <Stars value={r.overallRating} />
                  </TableCell>
                  <TableCell className="space-x-1">
                    <SentimentBadge value={r.sentiment} />
                    {r.wantsFollowUp ? <Badge variant="outline">Follow-up</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" render={<Link href={`/admin/feedback/${r.id}`} />}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {result.total.toLocaleString()} result{result.total === 1 ? "" : "s"} · page {result.page} of{" "}
          {pages}
        </span>
        <div className="flex gap-2">
          {result.page > 1 ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/admin/feedback?${qs(result.page - 1)}`} />}
            >
              Previous
            </Button>
          ) : null}
          {result.page < pages ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/admin/feedback?${qs(result.page + 1)}`} />}
            >
              Next
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
