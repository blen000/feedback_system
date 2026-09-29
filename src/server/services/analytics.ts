/**
 * Aggregations for the dashboard and reports. Every query is restricted by the actor's scope
 * in the database; charts and exports therefore can never include out-of-scope data.
 */
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { can, requirePermission, type AuthContext } from "@/lib/rbac/authorize";
import { locationWhere, qrWhere, type AccessScope } from "@/lib/rbac/scope";
import { dayKey, eachDay, today, addDays } from "@/lib/time";
import { feedbackFilterSchema, type FeedbackFilters } from "@/lib/validation/feedback";
import { parse } from "@/lib/validation/parse";
import { pick, type DefinitionQuestion, type QuestionnaireDefinition } from "@/lib/questionnaire/types";
import type { Table } from "@/lib/export/tabular";
import type { Prisma } from "@/generated/prisma/client";
import { feedbackWhere, formatAnswer } from "./feedback-admin";

const r1 = (n: number | null | undefined) =>
  n === null || n === undefined ? null : Math.round(n * 100) / 100;

/** Defaults to the last 30 days so unbounded reports never scan the whole table by accident. */
export function withDefaultRange(
  f: Partial<FeedbackFilters>,
  days = 30,
): Partial<FeedbackFilters> & { from: string; to: string } {
  const to = f.to ?? today();
  const from = f.from ?? addDays(to, -(days - 1));
  return { ...f, from, to };
}

export interface Overview {
  range: { from: string; to: string };
  totals: {
    feedback: number;
    averageRating: number | null;
    activeQuestionnaires: number | null;
    activeQrCodes: number | null;
    followUps: number;
  };
  sentiment: { POSITIVE: number; NEUTRAL: number; NEGATIVE: number; unrated: number };
  ratingDistribution: { rating: number; count: number }[];
  trend: { date: string; count: number; average: number | null }[];
  byDistrict: { name: string; count: number; average: number | null }[];
  byBranch: { name: string; count: number; average: number | null }[];
}

const MAX_TREND_ROWS = 200_000;

export async function getOverview(ctx: AuthContext, input: unknown): Promise<Overview> {
  requirePermission(ctx, "dashboard.view");
  const feedbackScope = can(ctx, "feedback.view") ? requirePermission(ctx, "feedback.view") : null;
  const filters = withDefaultRange(parse(feedbackFilterSchema, input));
  // A dashboard viewer without feedback.view sees no feedback figures at all.
  const where = feedbackScope ? feedbackWhere(feedbackScope, filters) : { id: { in: [] as string[] } };

  const [agg, sentiments, distribution, points, districts, branches, followUps] = await Promise.all([
    prisma.feedbackSubmission.aggregate({ where, _count: { _all: true }, _avg: { overallRating: true } }),
    prisma.feedbackSubmission.groupBy({ by: ["sentiment"], where, _count: { _all: true } }),
    prisma.feedbackSubmission.groupBy({
      by: ["overallRating"],
      where: { AND: [where, { overallRating: { not: null } }] },
      _count: { _all: true },
    }),
    prisma.feedbackSubmission.findMany({
      where,
      select: { submittedAt: true, overallRating: true },
      take: MAX_TREND_ROWS,
    }),
    prisma.feedbackSubmission.groupBy({
      by: ["districtId"],
      where,
      _count: { _all: true },
      _avg: { overallRating: true },
    }),
    prisma.feedbackSubmission.groupBy({
      by: ["branchId"],
      where,
      _count: { _all: true },
      _avg: { overallRating: true },
    }),
    prisma.feedbackSubmission.count({ where: { AND: [where, { wantsFollowUp: true }] } }),
  ]);

  // rating distribution in whole-star buckets (1–5), regardless of the source scale
  const buckets = new Map<number, number>([1, 2, 3, 4, 5].map((n) => [n, 0]));
  for (const d of distribution) {
    if (d.overallRating === null) continue;
    const b = Math.min(5, Math.max(1, Math.round(d.overallRating)));
    buckets.set(b, (buckets.get(b) ?? 0) + d._count._all);
  }

  const days = new Map<string, { n: number; sum: number; rated: number }>();
  for (const p of points) {
    const k = dayKey(p.submittedAt);
    const e = days.get(k) ?? { n: 0, sum: 0, rated: 0 };
    e.n++;
    if (p.overallRating !== null) {
      e.sum += p.overallRating;
      e.rated++;
    }
    days.set(k, e);
  }
  const trend = eachDay(filters.from, filters.to).map((date) => {
    const e = days.get(date);
    return { date, count: e?.n ?? 0, average: e && e.rated ? r1(e.sum / e.rated) : null };
  });

  const [districtNames, branchNames] = await Promise.all([
    prisma.district.findMany({
      where: { id: { in: districts.flatMap((d) => (d.districtId ? [d.districtId] : [])) } },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { id: { in: branches.flatMap((b) => (b.branchId ? [b.branchId] : [])) } },
      select: { id: true, name: true },
    }),
  ]);
  const dn = new Map(districtNames.map((d) => [d.id, d.name]));
  const bn = new Map(branchNames.map((b) => [b.id, b.name]));

  const sentiment = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0, unrated: 0 };
  for (const s of sentiments) {
    if (s.sentiment) sentiment[s.sentiment] = s._count._all;
    else sentiment.unrated = s._count._all;
  }

  const [activeQuestionnaires, activeQrCodes] = await Promise.all([
    can(ctx, "questionnaire.view")
      ? prisma.questionnaire.count({ where: { status: "ACTIVE", deletedAt: null } })
      : null,
    can(ctx, "qr.view")
      ? prisma.qRCode.count({
          where: { deletedAt: null, isActive: true, ...qrWhere(requirePermission(ctx, "qr.view")) },
        })
      : null,
  ]);

  return {
    range: { from: filters.from, to: filters.to },
    totals: {
      feedback: agg._count._all,
      averageRating: r1(agg._avg.overallRating),
      activeQuestionnaires,
      activeQrCodes,
      followUps,
    },
    sentiment,
    ratingDistribution: [...buckets].map(([rating, count]) => ({ rating, count })),
    trend,
    byDistrict: districts
      .flatMap((d) =>
        d.districtId
          ? [{ name: dn.get(d.districtId) ?? "—", count: d._count._all, average: r1(d._avg.overallRating) }]
          : [],
      )
      .sort((a, b) => b.count - a.count),
    byBranch: branches
      .flatMap((b) =>
        b.branchId
          ? [{ name: bn.get(b.branchId) ?? "—", count: b._count._all, average: r1(b._avg.overallRating) }]
          : [],
      )
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

// ───────────────────────── Question-level report ─────────────────────────

export interface QuestionStat {
  ref: string;
  question: string;
  type: string;
  answered: number;
  /** choice / yes-no / rating distributions */
  distribution?: { label: string; count: number }[];
  average?: number | null;
  min?: number | null;
  max?: number | null;
}

/** Per-question statistics for one questionnaire (across versions, matched by stable question ref). */
export async function getQuestionReport(
  ctx: AuthContext,
  input: unknown,
): Promise<{ questions: QuestionStat[]; total: number } | null> {
  requirePermission(ctx, "reports.view");
  const feedbackScope = requirePermission(ctx, "feedback.view");
  const f = withDefaultRange(parse(feedbackFilterSchema, input));
  if (!f.questionnaireId) return null;
  const where = feedbackWhere(feedbackScope, f);

  const versions = await prisma.questionnaireVersion.findMany({
    where: { questionnaireId: f.questionnaireId },
    orderBy: { version: "desc" },
  });
  if (versions.length === 0) throw notFound("Questionnaire");
  const questions = new Map<string, DefinitionQuestion>();
  let def0: QuestionnaireDefinition | undefined;
  for (const v of versions) {
    const def = v.definition as unknown as QuestionnaireDefinition;
    def0 ??= def;
    for (const q of def.questions) if (!questions.has(q.ref)) questions.set(q.ref, q);
  }

  const answerWhere: Prisma.FeedbackAnswerWhereInput = { submission: where };
  const [total, answers] = await Promise.all([
    prisma.feedbackSubmission.count({ where }),
    prisma.feedbackAnswer.findMany({
      where: answerWhere,
      select: { questionRef: true, valueNumber: true, valueOptions: true },
      take: 500_000,
    }),
  ]);
  const byRef = new Map<string, typeof answers>();
  for (const a of answers)
    (byRef.get(a.questionRef) ?? byRef.set(a.questionRef, []).get(a.questionRef)!).push(a);

  const stats: QuestionStat[] = [...questions.values()].map((q) => {
    const list = byRef.get(q.ref) ?? [];
    const base: QuestionStat = {
      ref: q.ref,
      question: pick(q.text, "en"),
      type: q.type,
      answered: list.length,
    };
    if (q.type === "YES_NO" || q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE") {
      const counts = new Map<string, number>();
      for (const a of list) for (const v of a.valueOptions) counts.set(v, (counts.get(v) ?? 0) + 1);
      const opts =
        q.type === "YES_NO"
          ? [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]
          : q.options.map((o) => ({ value: o.value, label: pick(o.label, "en") }));
      base.distribution = opts.map((o) => ({ label: o.label, count: counts.get(o.value) ?? 0 }));
    } else if (
      q.type === "STAR_RATING" ||
      q.type === "EMOJI_RATING" ||
      q.type === "NPS" ||
      q.type === "NUMBER"
    ) {
      const nums = list.flatMap((a) => (a.valueNumber === null ? [] : [a.valueNumber]));
      base.average = nums.length ? r1(nums.reduce((s, n) => s + n, 0) / nums.length) : null;
      base.min = nums.length ? Math.min(...nums) : null;
      base.max = nums.length ? Math.max(...nums) : null;
      if (q.type !== "NUMBER") {
        const lo = q.type === "NPS" ? 0 : 1;
        const hi = q.type === "NPS" ? 10 : q.type === "EMOJI_RATING" ? 5 : (q.config.scale ?? 5);
        base.distribution = Array.from({ length: hi - lo + 1 }, (_, i) => ({
          label: String(lo + i),
          count: nums.filter((n) => n === lo + i).length,
        }));
      }
    }
    return base;
  });
  return { questions: stats, total };
}

// ───────────────────────── Report tables (export) ─────────────────────────

/** Summary by branch/district for the chosen period, as an exportable table. */
export async function exportReportTable(
  ctx: AuthContext,
  input: unknown,
  format: "csv" | "xlsx",
): Promise<Table> {
  requirePermission(ctx, "reports.view");
  const exportScope = requirePermission(ctx, "reports.export");
  const viewScope: AccessScope = requirePermission(ctx, "feedback.view");
  const f = withDefaultRange(parse(feedbackFilterSchema, input));
  // both feedback.view and reports.export must cover every row
  const where: Prisma.FeedbackSubmissionWhereInput = {
    AND: [feedbackWhere(viewScope, f), locationWhere(exportScope) as Prisma.FeedbackSubmissionWhereInput],
  };

  const groups = await prisma.feedbackSubmission.groupBy({
    by: ["districtId", "branchId", "sentiment"],
    where,
    _count: { _all: true },
    _avg: { overallRating: true },
  });
  const ids = (k: "districtId" | "branchId") => [...new Set(groups.flatMap((g) => (g[k] ? [g[k]!] : [])))];
  const [ds, bs] = await Promise.all([
    prisma.district.findMany({ where: { id: { in: ids("districtId") } }, select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { id: { in: ids("branchId") } }, select: { id: true, name: true } }),
  ]);
  const dn = new Map(ds.map((d) => [d.id, d.name]));
  const bn = new Map(bs.map((b) => [b.id, b.name]));

  type Row = {
    district: string;
    branch: string;
    n: number;
    sum: number;
    rated: number;
    pos: number;
    neu: number;
    neg: number;
  };
  const rows = new Map<string, Row>();
  for (const g of groups) {
    const key = `${g.districtId}|${g.branchId}`;
    const r = rows.get(key) ?? {
      district: dn.get(g.districtId ?? "") ?? "",
      branch: bn.get(g.branchId ?? "") ?? "",
      n: 0,
      sum: 0,
      rated: 0,
      pos: 0,
      neu: 0,
      neg: 0,
    };
    r.n += g._count._all;
    if (g.sentiment) {
      // averages per (sentiment) group are re-weighted by their counts
      r.sum += (g._avg.overallRating ?? 0) * g._count._all;
      r.rated += g._count._all;
      if (g.sentiment === "POSITIVE") r.pos += g._count._all;
      else if (g.sentiment === "NEUTRAL") r.neu += g._count._all;
      else r.neg += g._count._all;
    }
    rows.set(key, r);
  }
  const table: Table = {
    name: "Summary",
    columns: [
      "From",
      "To",
      "District",
      "Branch",
      "Responses",
      "Average rating (1-5)",
      "Positive",
      "Neutral",
      "Negative",
    ],
    rows: [...rows.values()]
      .sort((a, b) => (a.district + a.branch).localeCompare(b.district + b.branch))
      .map((r) => [
        f.from,
        f.to,
        r.district,
        r.branch,
        r.n,
        r.rated ? r1(r.sum / r.rated) : null,
        r.pos,
        r.neu,
        r.neg,
      ]),
  };
  await writeAudit({
    actorId: ctx.userId,
    action: "FEEDBACK_EXPORTED",
    resource: "Report",
    metadata: { format, rows: table.rows.length, filters: { ...f, page: undefined } },
  });
  return table;
}

export { formatAnswer };
