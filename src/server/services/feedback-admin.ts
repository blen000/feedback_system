/**
 * Staff-facing feedback queries. Every read is filtered by the actor's scope IN THE DATABASE,
 * and single-record reads use the same filter, so guessing an id never reveals out-of-scope data (IDOR-safe).
 */
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { can, requirePermission, type AuthContext } from "@/lib/rbac/authorize";
import {
  branchWhere,
  districtWhere,
  locationWhere,
  resolveScope,
  scopeCoversTarget,
  type AccessScope,
  type Target,
} from "@/lib/rbac/scope";
import { dayEndExclusive, dayStart } from "@/lib/time";
import { feedbackFilterSchema, type FeedbackFilters } from "@/lib/validation/feedback";
import { parse } from "@/lib/validation/parse";
import {
  EMOJI_SCALE,
  pick,
  type DefinitionQuestion,
  type QuestionnaireDefinition,
} from "@/lib/questionnaire/types";
import type { Prisma } from "@/generated/prisma/client";
import type { Cell, Table } from "@/lib/export/tabular";

export const PAGE_SIZE = 25;
export const EXPORT_ROW_CAP = 20_000;

/** Builds the WHERE for submissions: soft-delete + organizational scope + user filters. */
export function feedbackWhere(
  scope: AccessScope,
  f: Partial<FeedbackFilters>,
): Prisma.FeedbackSubmissionWhereInput {
  const and: Prisma.FeedbackSubmissionWhereInput[] = [
    { deletedAt: null },
    locationWhere(scope) as Prisma.FeedbackSubmissionWhereInput,
  ];
  if (f.from) and.push({ submittedAt: { gte: dayStart(f.from) } });
  if (f.to) and.push({ submittedAt: { lt: dayEndExclusive(f.to) } });
  if (f.districtId) and.push({ districtId: f.districtId });
  if (f.branchId) and.push({ branchId: f.branchId });
  if (f.departmentId) and.push({ departmentId: f.departmentId });
  if (f.questionnaireId) and.push({ questionnaireId: f.questionnaireId });
  if (f.sentiment) and.push({ sentiment: f.sentiment });
  if (f.minRating !== undefined) and.push({ overallRating: { gte: f.minRating } });
  if (f.maxRating !== undefined) and.push({ overallRating: { lte: f.maxRating } });
  if (f.followUp) and.push({ wantsFollowUp: true });
  if (f.questionRef && f.answer) {
    and.push({ answers: { some: { questionRef: f.questionRef, valueOptions: { has: f.answer } } } });
  }
  if (f.q) and.push({ answers: { some: { valueText: { contains: f.q, mode: "insensitive" } } } });
  return { AND: and };
}

const locationInclude = {
  district: { select: { name: true } },
  branch: { select: { name: true, district: { select: { name: true } } } },
  department: { select: { name: true } },
} satisfies Prisma.FeedbackSubmissionInclude;

type WithLocation = Prisma.FeedbackSubmissionGetPayload<{ include: typeof locationInclude }>;

function locationLabel(s: WithLocation) {
  return {
    branch: s.branch?.name ?? null,
    district: s.branch?.district.name ?? s.district?.name ?? null,
    department: s.department?.name ?? null,
    label: s.branch?.name ?? s.department?.name ?? s.district?.name ?? "—",
  };
}

const titleOf = (translations: { locale: string; title: string }[], locale: string) =>
  translations.find((t) => t.locale === locale)?.title ?? translations[0]?.title ?? "(untitled)";

// ───────────────────────── List ─────────────────────────

export async function listFeedback(ctx: AuthContext, input: unknown) {
  const scope = requirePermission(ctx, "feedback.view");
  const f = parse(feedbackFilterSchema, input);
  const where = feedbackWhere(scope, f);
  const [rows, total] = await Promise.all([
    prisma.feedbackSubmission.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { ...locationInclude, questionnaire: { select: { defaultLocale: true, translations: true } } },
    }),
    prisma.feedbackSubmission.count({ where }),
  ]);
  return {
    total,
    page: f.page,
    pageSize: PAGE_SIZE,
    rows: rows.map((r) => ({
      id: r.id,
      submittedAt: r.submittedAt,
      location: locationLabel(r),
      questionnaire: titleOf(r.questionnaire.translations, r.questionnaire.defaultLocale),
      overallRating: r.overallRating,
      sentiment: r.sentiment,
      wantsFollowUp: r.wantsFollowUp,
    })),
  };
}

/** Options for the filter bar, limited to what the actor may see. */
export async function feedbackFilterOptions(ctx: AuthContext) {
  const scope = requirePermission(ctx, "feedback.view");
  const [districts, branches, grouped] = await Promise.all([
    prisma.district.findMany({
      where: { deletedAt: null, ...districtWhere(scope) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { deletedAt: null, ...branchWhere(scope) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, districtId: true },
    }),
    prisma.feedbackSubmission.groupBy({ by: ["questionnaireId"], where: feedbackWhere(scope, {}) }),
  ]);
  const questionnaires = await prisma.questionnaire.findMany({
    where: { id: { in: grouped.map((g) => g.questionnaireId) } },
    select: { id: true, defaultLocale: true, translations: true },
  });
  return {
    districts,
    branches,
    questionnaires: questionnaires
      .map((q) => ({ id: q.id, title: titleOf(q.translations, q.defaultLocale) }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

/** Choice / yes-no questions of a questionnaire's latest version, for the "answer" filter. */
export async function answerFilterOptions(ctx: AuthContext, questionnaireId: string) {
  const scope = requirePermission(ctx, "feedback.view");
  const any = await prisma.feedbackSubmission.findFirst({
    where: feedbackWhere(scope, { questionnaireId }),
    select: { id: true },
  });
  if (!any) return [];
  const latest = await prisma.questionnaireVersion.findFirst({
    where: { questionnaireId },
    orderBy: { version: "desc" },
  });
  if (!latest) return [];
  const def = latest.definition as unknown as QuestionnaireDefinition;
  return def.questions
    .filter((q) => q.type === "YES_NO" || q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE")
    .map((q) => ({
      ref: q.ref,
      text: pick(q.text, def.defaultLocale),
      options: optionsOf(q).map((o) => ({ value: o.value, label: o.label })),
    }));
}

function optionsOf(q: DefinitionQuestion, locale = "en") {
  if (q.type === "YES_NO")
    return [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];
  return q.options.map((o) => ({ value: o.value, label: pick(o.label, locale) }));
}

// ───────────────────────── Detail ─────────────────────────

function targetOf(s: {
  branchId: string | null;
  districtId: string | null;
  departmentId: string | null;
}): Target {
  if (s.branchId) return { type: "BRANCH", branchId: s.branchId, districtId: s.districtId ?? "" };
  if (s.departmentId) return { type: "DEPARTMENT", departmentId: s.departmentId, districtId: s.districtId };
  if (s.districtId) return { type: "DISTRICT", districtId: s.districtId };
  return { type: "ALL" };
}

/** Contact details need their own permission, over the record's location. */
function mayViewContact(
  ctx: AuthContext,
  s: { branchId: string | null; districtId: string | null; departmentId: string | null },
) {
  return (
    can(ctx, "feedback.view_contact") &&
    scopeCoversTarget(resolveScope(ctx.assignments, "feedback.view_contact"), targetOf(s))
  );
}

export function formatAnswer(
  q: DefinitionQuestion,
  a: { valueText: string | null; valueNumber: number | null; valueOptions: string[] },
  locale = "en",
): string {
  switch (q.type) {
    case "YES_NO":
      return a.valueOptions[0] === "yes" ? "Yes" : "No";
    case "STAR_RATING":
      return `${a.valueNumber} / ${q.config.scale ?? 5}`;
    case "EMOJI_RATING":
      return `${EMOJI_SCALE[(a.valueNumber ?? 1) - 1] ?? ""} (${a.valueNumber} / ${EMOJI_SCALE.length})`;
    case "NPS":
      return `${a.valueNumber} / 10`;
    case "NUMBER":
      return String(a.valueNumber);
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return a.valueText ?? "";
    case "SINGLE_CHOICE":
    case "MULTIPLE_CHOICE":
      return a.valueOptions
        .map((v) => pick(q.options.find((o) => o.value === v)?.label, locale) || v)
        .join(", ");
  }
}

export async function getFeedbackDetail(ctx: AuthContext, id: string) {
  const scope = requirePermission(ctx, "feedback.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Feedback");
  const include = {
    ...locationInclude,
    answers: true,
    version: true,
    forwards: {
      orderBy: { createdAt: "desc" as const },
      include: { from: { select: { name: true } }, to: { select: { name: true } } },
    },
  };

  // Scope is part of the query: out-of-scope ids are indistinguishable from non-existent ones.
  let s = await prisma.feedbackSubmission.findFirst({
    where: { AND: [{ id }, feedbackWhere(scope, {})] },
    include,
  });
  const inScope = !!s;
  // A record outside the user's scope is visible only if a colleague forwarded it to them.
  if (!s) {
    const shared = await prisma.feedbackForward.findFirst({
      where: { feedbackId: id, toUserId: ctx.userId, feedback: { deletedAt: null } },
      select: { id: true },
    });
    if (!shared) throw notFound("Feedback");
    s = await prisma.feedbackSubmission.findFirst({ where: { id, deletedAt: null }, include });
    if (!s) throw notFound("Feedback");
  }

  // Opening a forwarded record marks it read.
  const mine = s.forwards.find((f) => f.toUserId === ctx.userId);
  if (mine && !mine.readAt)
    await prisma.feedbackForward.update({ where: { id: mine.id }, data: { readAt: new Date() } });

  const def = s.version.definition as unknown as QuestionnaireDefinition;
  const byRef = new Map(s.answers.map((a) => [a.questionRef, a]));
  const answers = def.questions.flatMap((q) => {
    const a = byRef.get(q.ref);
    return a
      ? [
          {
            ref: q.ref,
            question: pick(q.text, s!.locale, def.defaultLocale),
            type: q.type,
            answer: formatAnswer(q, a, s!.locale),
          },
        ]
      : [];
  });
  const showContact = mayViewContact(ctx, s);
  const canForward =
    inScope &&
    can(ctx, "feedback.forward") &&
    scopeCoversTarget(resolveScope(ctx.assignments, "feedback.forward"), targetOf(s));
  return {
    id: s.id,
    submittedAt: s.submittedAt,
    location: locationLabel(s),
    questionnaire: pick(def.title, s.locale, def.defaultLocale),
    version: s.version.version,
    locale: s.locale,
    overallRating: s.overallRating,
    sentiment: s.sentiment,
    wantsFollowUp: s.wantsFollowUp,
    // PII: only when the questionnaire collected it AND this user is allowed to see it
    contactPhone: showContact ? s.contactPhone : null,
    contactHidden: !!s.contactPhone && !showContact,
    answers,
    canDelete: inScope && can(ctx, "feedback.delete"),
    canForward,
    /** shown to the recipient: who sent it and why */
    forwardedToMe: mine ? { from: mine.from.name, note: mine.note, at: mine.createdAt } : null,
    /** shown to people who can forward: where this record has been sent */
    forwards: canForward
      ? s.forwards.map((f) => ({
          id: f.id,
          from: f.from.name,
          to: f.to.name,
          note: f.note,
          at: f.createdAt,
          read: !!f.readAt,
        }))
      : [],
  };
}

export async function deleteFeedback(ctx: AuthContext, id: string) {
  const scope = requirePermission(ctx, "feedback.delete");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Feedback");
  const s = await prisma.feedbackSubmission.findFirst({
    where: { AND: [{ id }, feedbackWhere(scope, {})] },
    select: { id: true },
  });
  if (!s) throw notFound("Feedback");
  await prisma.feedbackSubmission.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit({ actorId: ctx.userId, action: "FEEDBACK_DELETED", resource: "Feedback", resourceId: id });
}

// ───────────────────────── Export ─────────────────────────

/**
 * Rows for CSV/Excel. Uses the same scope filter as the list, so a user can never export what they cannot view.
 * One column per question (matched across versions by stable question ref).
 */
export async function exportFeedbackTable(
  ctx: AuthContext,
  input: unknown,
  format: "csv" | "xlsx",
): Promise<Table> {
  // A user must never export what they cannot view: rows must satisfy BOTH permissions' scopes.
  const viewScope = requirePermission(ctx, "feedback.view");
  const exportScope = requirePermission(ctx, "feedback.export");
  const f = parse(feedbackFilterSchema, input);
  const where: Prisma.FeedbackSubmissionWhereInput = {
    AND: [feedbackWhere(viewScope, f), feedbackWhere(exportScope, {})],
  };
  const total = await prisma.feedbackSubmission.count({ where });
  const subs = await prisma.feedbackSubmission.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    take: EXPORT_ROW_CAP,
    include: {
      ...locationInclude,
      answers: true,
      version: true,
      questionnaire: { select: { defaultLocale: true, translations: true } },
    },
  });

  // column set: refs in first-seen order, newest version's wording wins
  const cols = new Map<string, DefinitionQuestion>();
  const defs = new Map<string, QuestionnaireDefinition>();
  for (const s of [...subs].sort((a, b) => b.version.version - a.version.version)) {
    const def = s.version.definition as unknown as QuestionnaireDefinition;
    defs.set(s.versionId, def);
    for (const q of def.questions) if (!cols.has(q.ref)) cols.set(q.ref, q);
  }
  const questions = [...cols.values()];
  const withContact = can(ctx, "feedback.view_contact");

  const columns = [
    "Submitted",
    "Questionnaire",
    "District",
    "Branch",
    "Department",
    "Overall rating (1-5)",
    "Sentiment",
    "Follow-up requested",
    ...(withContact ? ["Phone"] : []),
    ...questions.map((q) => pick(q.text, "en")),
  ];
  const rows: Cell[][] = subs.map((s) => {
    const byRef = new Map(s.answers.map((a) => [a.questionRef, a]));
    const loc = locationLabel(s);
    return [
      s.submittedAt,
      titleOf(s.questionnaire.translations, s.questionnaire.defaultLocale),
      loc.district,
      loc.branch,
      loc.department,
      s.overallRating === null ? null : Math.round(s.overallRating * 100) / 100,
      s.sentiment,
      s.wantsFollowUp ? "Yes" : "No",
      ...(withContact ? [mayViewContact(ctx, s) ? s.contactPhone : null] : []),
      ...questions.map((q) => {
        const a = byRef.get(q.ref);
        return a ? formatAnswer(q, a, "en") : null;
      }),
    ];
  });

  await writeAudit({
    actorId: ctx.userId,
    action: "FEEDBACK_EXPORTED",
    resource: "Feedback",
    metadata: {
      format,
      rows: rows.length,
      matched: total,
      truncated: total > EXPORT_ROW_CAP,
      filters: { ...f, page: undefined },
    },
  });
  return { name: "Feedback", columns, rows };
}
