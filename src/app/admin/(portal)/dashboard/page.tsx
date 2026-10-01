import type { Metadata } from "next";
import Link from "next/link";
import { KpiRow, OverviewCharts } from "@/components/charts/overview-charts";
import { FilterBar } from "@/components/feedback/filter-bar";
import { MarkReadButton } from "@/components/feedback/mark-read-button";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { addDays, today } from "@/lib/time";
import { parseFilters } from "@/lib/validation/feedback";
import { getOverview } from "@/server/services/analytics";
import { getAccessSummary } from "@/server/services/dashboard";
import { feedbackFilterOptions } from "@/server/services/feedback-admin";
import { listMyNotifications } from "@/server/services/notifications";

export const metadata: Metadata = { title: "Dashboard" };

const PRESETS = [
  [7, "Last 7 days"],
  [30, "Last 30 days"],
  [90, "Last 90 days"],
] as const;

export default async function DashboardPage({ searchParams }: PageProps<"/admin/dashboard">) {
  const { ctx } = await pageAccess("dashboard.view");

  const filters = parseFilters(await searchParams);
  const canSeeFeedback = can(ctx, "feedback.view");
  const [overview, access, notifications, options] = await Promise.all([
    getOverview(ctx, filters),
    getAccessSummary(ctx),
    listMyNotifications(ctx, 6),
    canSeeFeedback ? feedbackFilterOptions(ctx) : null,
  ]);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title={`Welcome, ${ctx.name}`}
        description="Feedback performance across the locations you can access."
      />

      {canSeeFeedback && options ? (
        <>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(([days, label]) => (
              <Button
                key={days}
                size="sm"
                variant="outline"
                render={
                  <Link href={`/admin/dashboard?from=${addDays(today(), -(days - 1))}&to=${today()}`} />
                }
              >
                {label}
              </Button>
            ))}
          </div>
          <FilterBar
            action="/admin/dashboard"
            filters={{ ...filters, from: overview.range.from, to: overview.range.to }}
            options={options}
            show={{ search: false, rating: false, answer: false }}
          />
          <KpiRow o={overview} />
          <OverviewCharts o={overview} />
        </>
      ) : (
        <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
          Your role does not include access to feedback data, so performance figures are not shown.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Low ratings and follow-up requests at your locations.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {unread > 0 ? (
              <div>
                <MarkReadButton />
              </div>
            ) : null}
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : null}
            {notifications.map((n) => (
              <div key={n.id} className="border-b pb-2 text-sm last:border-0">
                <p className="flex items-center gap-2 font-medium">
                  {n.title} {n.readAt ? null : <Badge>New</Badge>}
                </p>
                {n.body ? <p className="text-muted-foreground">{n.body}</p> : null}
                <p className="text-xs text-muted-foreground">
                  {n.createdAt.toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Africa/Addis_Ababa",
                  })}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your access</CardTitle>
            <CardDescription>
              Roles on your account and where they apply.
              {access.counts.branches !== null
                ? ` ${access.counts.branches} branch${access.counts.branches === 1 ? "" : "es"} in scope.`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {access.access.map((a, i) => (
              <Badge key={i} variant="secondary">
                {a.role} · {a.scope}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
