import { CheckCircle2Icon, MinusCircleIcon, XCircleIcon } from "lucide-react";
import { Stars } from "@/components/feedback/rating";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Overview } from "@/server/services/analytics";
import { ChartCard, HorizontalBars, LineOverTime, VerticalBars } from "./charts";

export function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
    </Card>
  );
}

export function KpiRow({ o }: { o: Overview }) {
  const t = o.totals;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        label="Total feedback"
        value={t.feedback.toLocaleString()}
        hint={`${o.range.from} → ${o.range.to}`}
      />
      <Kpi
        label="Average rating"
        value={t.averageRating === null ? "—" : <Stars value={t.averageRating} />}
        hint="Out of 5, from the overall-rating question"
      />
      {t.activeQuestionnaires !== null ? (
        <Kpi label="Active questionnaires" value={t.activeQuestionnaires} />
      ) : null}
      {t.activeQrCodes !== null ? <Kpi label="Active QR codes" value={t.activeQrCodes} /> : null}
    </div>
  );
}

/** Positive / neutral / negative. Status colours always come with an icon and a label. */
export function SentimentSummary({ o }: { o: Overview }) {
  const s = o.sentiment;
  const rated = s.POSITIVE + s.NEUTRAL + s.NEGATIVE;
  const pct = (n: number) => (rated ? Math.round((n / rated) * 100) : 0);
  const rows = [
    { label: "Positive", n: s.POSITIVE, color: "var(--viz-good)", Icon: CheckCircle2Icon },
    { label: "Neutral", n: s.NEUTRAL, color: "var(--viz-warn)", Icon: MinusCircleIcon },
    { label: "Negative", n: s.NEGATIVE, color: "var(--viz-bad)", Icon: XCircleIcon },
  ];
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-medium">Sentiment</h2>
      <p className="text-xs text-muted-foreground">
        Share of rated responses: 4+ positive, above 2.5 neutral, otherwise negative.
      </p>
      <div className="mt-3 grid gap-3">
        {rows.map(({ label, n, color, Icon }) => (
          <div key={label}>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5">
                <Icon className="size-4" style={{ color }} aria-hidden /> {label}
              </span>
              <span className="tabular-nums">
                {n.toLocaleString()} · {pct(n)}%
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${pct(n)}%`, background: color }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function OverviewCharts({ o }: { o: Overview }) {
  const none = o.totals.feedback === 0;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Feedback over time"
        description="Responses per day"
        empty={none}
        table={{ columns: ["Date", "Responses"], rows: o.trend.map((d) => [d.date, d.count]) }}
      >
        <LineOverTime data={o.trend.map((d) => ({ date: d.date, value: d.count }))} unit="responses" />
      </ChartCard>
      <ChartCard
        title="Average rating over time"
        description="Daily average, 1–5 (days without ratings are skipped)"
        empty={none}
        table={{ columns: ["Date", "Average"], rows: o.trend.map((d) => [d.date, d.average]) }}
      >
        <LineOverTime
          data={o.trend.map((d) => ({ date: d.date, value: d.average }))}
          unit="/ 5"
          domain={[1, 5]}
        />
      </ChartCard>
      <ChartCard
        title="Rating distribution"
        description="Responses by whole-star rating"
        empty={none}
        table={{
          columns: ["Rating", "Responses"],
          rows: o.ratingDistribution.map((r) => [r.rating, r.count]),
        }}
      >
        <VerticalBars
          data={o.ratingDistribution.map((r) => ({ name: `${r.rating}★`, value: r.count }))}
          unit="responses"
        />
      </ChartCard>
      <SentimentSummary o={o} />
      {o.byDistrict.length > 1 ? (
        <ChartCard
          title="Feedback by district"
          empty={none}
          table={{
            columns: ["District", "Responses", "Avg rating"],
            rows: o.byDistrict.map((d) => [d.name, d.count, d.average]),
          }}
        >
          <HorizontalBars
            data={o.byDistrict.map((d) => ({ name: d.name, value: d.count }))}
            unit="responses"
          />
        </ChartCard>
      ) : null}
      <ChartCard
        title="Feedback by branch"
        description="Top 10 by responses"
        empty={none}
        table={{
          columns: ["Branch", "Responses", "Avg rating"],
          rows: o.byBranch.map((b) => [b.name, b.count, b.average]),
        }}
      >
        <HorizontalBars data={o.byBranch.map((b) => ({ name: b.name, value: b.count }))} unit="responses" />
      </ChartCard>
    </div>
  );
}
