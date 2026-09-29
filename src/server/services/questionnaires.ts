/**
 * Questionnaire lifecycle.
 *
 *   DRAFT ──publish──▶ PUBLISHED ──activate──▶ ACTIVE ──pause──▶ PAUSED ──activate──▶ ACTIVE
 *     ▲                    │                      │                │
 *     └──── reopen ────────┴──────────────────────┼── (PAUSED) ────┘
 *                                                 └──── close ───▶ CLOSED (terminal)
 *
 * Only DRAFT is editable. Publishing freezes an immutable QuestionnaireVersion snapshot, so
 * feedback already collected can never be altered by later edits. Only ACTIVE questionnaires
 * accept feedback, and to change one you pause it, reopen it as a draft and publish a new version.
 */
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { writeAudit, type AuditAction } from "@/lib/audit";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, requirePermissionOn, type AuthContext } from "@/lib/rbac/authorize";
import { branchWhere, departmentWhere, districtWhere, type ScopeType } from "@/lib/rbac/scope";
import {
  CHOICE_TYPES,
  DEFAULT_LOCALE,
  RATING_TYPES,
  type DefinitionQuestion,
  type Localized,
  type QuestionConfig,
  type QuestionnaireDefinition,
  type Visibility,
} from "@/lib/questionnaire/types";
import {
  assignmentsSchema,
  draftSchema,
  questionnaireMetaSchema,
  type AssignmentTarget,
} from "@/lib/validation/questionnaire";
import { parse } from "@/lib/validation/parse";
import { Prisma, type QuestionnaireStatus } from "@/generated/prisma/client";
import { presentQuestion, type LibraryQuestion } from "./questions";
import { resolveTarget } from "./targets";

const questionInclude = {
  translations: true,
  options: { orderBy: { sortOrder: "asc" as const }, include: { translations: true } },
  _count: { select: { usages: true } },
} satisfies Prisma.QuestionInclude;

const fullInclude = {
  translations: true,
  questions: { orderBy: { sortOrder: "asc" as const }, include: { question: { include: questionInclude } } },
  assignments: true,
} satisfies Prisma.QuestionnaireInclude;

type Full = Prisma.QuestionnaireGetPayload<{ include: typeof fullInclude }>;

// ───────────────────────── Definition snapshots ─────────────────────────

function pickLocales(all: Localized, allowed: string[]): Localized {
  return Object.fromEntries(Object.entries(all).filter(([l, v]) => allowed.includes(l) && v));
}

/** Builds the customer-facing definition from the working copy. Also used by preview. */
export function buildDefinition(q: Full, version: number): QuestionnaireDefinition {
  const locales = q.locales;
  const title: Localized = {};
  const description: Localized = {};
  for (const t of q.translations) {
    if (!locales.includes(t.locale)) continue;
    title[t.locale] = t.title;
    if (t.description) description[t.locale] = t.description;
  }

  const questions: DefinitionQuestion[] = q.questions
    .filter((item) => item.isActive && item.question.isActive && !item.question.deletedAt)
    .map((item) => {
      const lib = presentQuestion(item.question);
      return {
        ref: item.id,
        type: lib.type,
        text: pickLocales(lib.text, locales),
        description: pickLocales(lib.description, locales),
        placeholder: pickLocales(lib.placeholder, locales),
        required: item.isRequired,
        isPrimaryRating: item.isPrimaryRating,
        config: { ...lib.config, ...((item.configOverride ?? {}) as QuestionConfig) },
        options: lib.options.map((o) => ({ value: o.value, label: pickLocales(o.label, locales) })),
        visibility: (item.visibility as Visibility | null) ?? null,
      };
    });

  return {
    questionnaireId: q.id,
    version,
    defaultLocale: q.defaultLocale,
    locales,
    collectContact: q.collectContact,
    title,
    description,
    questions,
  };
}

/** Everything that must hold before customers may see a questionnaire. */
export function publishProblems(def: QuestionnaireDefinition): string[] {
  const problems: string[] = [];
  const dl = def.defaultLocale;
  if (!def.title[dl]) problems.push("The questionnaire needs a title in the default language.");
  if (def.questions.length === 0) problems.push("Add at least one active question.");

  const refs = new Set<string>();
  let primary = 0;
  def.questions.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (!q.text[dl]) problems.push(`${n} has no text in the default language.`);
    if (CHOICE_TYPES.includes(q.type) && q.options.length < 2)
      problems.push(`${n} needs at least two options.`);
    for (const o of q.options) if (!o.label[dl]) problems.push(`${n} has an option without a label.`);
    if (q.isPrimaryRating) {
      primary++;
      if (!RATING_TYPES.includes(q.type))
        problems.push(`${n} cannot be the overall rating (not a rating question).`);
    }
    for (const r of q.visibility?.rules ?? []) {
      if (!refs.has(r.questionRef))
        problems.push(`${n} depends on a question that is inactive, removed or placed after it.`);
    }
    refs.add(q.ref);
  });
  if (primary > 1) problems.push("Only one question can be the overall rating.");
  return problems;
}

// ───────────────────────── Reads ─────────────────────────

async function loadFull(id: string): Promise<Full> {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Questionnaire");
  const q = await prisma.questionnaire.findFirst({ where: { id, deletedAt: null }, include: fullInclude });
  if (!q) throw notFound("Questionnaire");
  return q;
}

export async function listQuestionnaires(ctx: AuthContext) {
  requirePermission(ctx, "questionnaire.view");
  const rows = await prisma.questionnaire.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { translations: true, _count: { select: { questions: true, assignments: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    title: r.translations.find((t) => t.locale === r.defaultLocale)?.title ?? "(untitled)",
    questionCount: r._count.questions,
    assignmentCount: r._count.assignments,
    latestVersion: r.latestVersion,
    updatedAt: r.updatedAt,
  }));
}

export interface EditorQuestion {
  ref: string;
  questionId: string;
  isRequired: boolean;
  isActive: boolean;
  isPrimaryRating: boolean;
  visibility: Visibility | null;
  library: LibraryQuestion;
}

export async function getQuestionnaireEditor(ctx: AuthContext, id: string) {
  requirePermission(ctx, "questionnaire.view");
  const q = await loadFull(id);
  const assignments = await labelAssignments(q.assignments);
  return {
    id: q.id,
    status: q.status,
    latestVersion: q.latestVersion,
    meta: {
      title: Object.fromEntries(q.translations.map((t) => [t.locale, t.title])) as Localized,
      description: Object.fromEntries(
        q.translations.flatMap((t) => (t.description ? [[t.locale, t.description]] : [])),
      ) as Localized,
      defaultLocale: q.defaultLocale,
      locales: q.locales,
      collectContact: q.collectContact,
    },
    questions: q.questions.map((i): EditorQuestion => ({
      ref: i.id,
      questionId: i.questionId,
      isRequired: i.isRequired,
      isActive: i.isActive,
      isPrimaryRating: i.isPrimaryRating,
      visibility: (i.visibility as Visibility | null) ?? null,
      library: presentQuestion(i.question),
    })),
    assignments,
  };
}

async function labelAssignments(
  rows: { districtId: string | null; branchId: string | null; departmentId: string | null }[],
) {
  const [districts, branches, departments] = await Promise.all([
    prisma.district.findMany({
      where: { id: { in: rows.flatMap((r) => (r.districtId ? [r.districtId] : [])) } },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { id: { in: rows.flatMap((r) => (r.branchId ? [r.branchId] : [])) } },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { id: { in: rows.flatMap((r) => (r.departmentId ? [r.departmentId] : [])) } },
      select: { id: true, name: true },
    }),
  ]);
  const name = (list: { id: string; name: string }[], id: string) =>
    list.find((x) => x.id === id)?.name ?? "—";
  return rows.map((r) =>
    r.branchId
      ? { scopeType: "BRANCH" as const, id: r.branchId, label: `Branch: ${name(branches, r.branchId)}` }
      : r.departmentId
        ? {
            scopeType: "DEPARTMENT" as const,
            id: r.departmentId,
            label: `Department: ${name(departments, r.departmentId)}`,
          }
        : r.districtId
          ? {
              scopeType: "DISTRICT" as const,
              id: r.districtId,
              label: `District: ${name(districts, r.districtId)}`,
            }
          : { scopeType: "ALL" as const, id: undefined, label: "Entire bank (default)" },
  );
}

/** Locations the actor may assign a questionnaire to (convenience for the UI; re-checked on save). */
export async function listAssignableLocations(ctx: AuthContext) {
  const scope = requirePermission(ctx, "questionnaire.publish");
  const [districts, branches, departments] = await Promise.all([
    prisma.district.findMany({
      where: { deletedAt: null, ...districtWhere(scope) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { deletedAt: null, ...branchWhere(scope) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { deletedAt: null, ...departmentWhere(scope) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { districts, branches, departments, canAssignAll: scope.all };
}

/** Unsaved-safe preview: builds the customer view from the saved draft. Never writes feedback. */
export async function previewDefinition(ctx: AuthContext, id: string): Promise<QuestionnaireDefinition> {
  requirePermission(ctx, "questionnaire.view");
  return buildDefinition(await loadFull(id), 0);
}

// ───────────────────────── Writes ─────────────────────────

export async function createQuestionnaire(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "questionnaire.create");
  const meta = parse(questionnaireMetaSchema, input);
  const q = await prisma.questionnaire.create({
    data: {
      defaultLocale: meta.defaultLocale,
      locales: meta.locales,
      collectContact: meta.collectContact,
      createdById: ctx.userId,
      translations: {
        create: Object.entries(meta.title).map(([locale, title]) => ({
          locale,
          title,
          description: meta.description?.[locale] ?? null,
        })),
      },
    },
  });
  await writeAudit({
    actorId: ctx.userId,
    action: "QUESTIONNAIRE_CREATED",
    resource: "Questionnaire",
    resourceId: q.id,
    metadata: { title: meta.title },
  });
  return { id: q.id };
}

/** "Save draft": replaces metadata and the ordered question list. Item refs are stable across saves. */
export async function saveDraft(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "questionnaire.update");
  const existing = await loadFull(id);
  if (existing.status !== "DRAFT") {
    throw conflict(
      "Only a draft can be edited. Pause the questionnaire and reopen it as a draft to make changes.",
    );
  }
  const { meta, questions } = parse(draftSchema, input);

  // The library questions must exist; refs must not belong to a different questionnaire.
  const [library, foreign] = await Promise.all([
    prisma.question.findMany({
      where: { id: { in: questions.map((q) => q.questionId) }, deletedAt: null },
      select: { id: true, type: true },
    }),
    prisma.questionnaireQuestion.findMany({
      where: { id: { in: questions.map((q) => q.ref) }, questionnaireId: { not: id } },
      select: { id: true },
    }),
  ]);
  if (foreign.length) throw forbidden();
  const typeOf = new Map(library.map((l) => [l.id, l.type]));
  for (const [i, q] of questions.entries()) {
    const type = typeOf.get(q.questionId);
    if (!type)
      throw invalid("A selected question no longer exists.", {
        [`questions.${i}`]: ["This question no longer exists."],
      });
    if (q.isPrimaryRating && !RATING_TYPES.includes(type)) {
      throw invalid("Please correct the highlighted fields.", {
        [`questions.${i}`]: ["Only a rating question can be the overall rating."],
      });
    }
  }

  const keep = new Set(questions.map((q) => q.ref));
  const existingRefs = new Set(existing.questions.map((q) => q.id));

  await prisma.$transaction(async (tx) => {
    await tx.questionnaire.update({
      where: { id },
      data: { defaultLocale: meta.defaultLocale, locales: meta.locales, collectContact: meta.collectContact },
    });
    await tx.questionnaireTranslation.deleteMany({ where: { questionnaireId: id } });
    await tx.questionnaireTranslation.createMany({
      data: Object.entries(meta.title).map(([locale, title]) => ({
        questionnaireId: id,
        locale,
        title,
        description: meta.description?.[locale] ?? null,
      })),
    });

    // Clear the "one primary rating" partial-unique index before re-applying flags.
    await tx.questionnaireQuestion.updateMany({
      where: { questionnaireId: id },
      data: { isPrimaryRating: false },
    });
    await tx.questionnaireQuestion.deleteMany({ where: { questionnaireId: id, id: { notIn: [...keep] } } });

    for (const [order, q] of questions.entries()) {
      const data = {
        questionId: q.questionId,
        sortOrder: order,
        isRequired: q.isRequired,
        isActive: q.isActive,
        isPrimaryRating: q.isPrimaryRating,
        visibility: q.visibility ? (q.visibility as Prisma.InputJsonValue) : Prisma.DbNull,
      };
      if (existingRefs.has(q.ref)) {
        await tx.questionnaireQuestion.update({
          where: { id: q.ref },
          data,
        });
      } else {
        await tx.questionnaireQuestion.create({ data: { id: q.ref, questionnaireId: id, ...data } });
      }
    }
  });

  await writeAudit({
    actorId: ctx.userId,
    action: "QUESTIONNAIRE_UPDATED",
    resource: "Questionnaire",
    resourceId: id,
    metadata: { questions: questions.length },
  });
}

async function transition(
  ctx: AuthContext,
  id: string,
  from: QuestionnaireStatus[],
  to: QuestionnaireStatus,
  action: AuditAction,
  extra: Prisma.QuestionnaireUpdateManyMutationInput = {},
) {
  // atomic compare-and-set on status: concurrent requests cannot both transition
  const res = await prisma.questionnaire.updateMany({
    where: { id, deletedAt: null, status: { in: from } },
    data: { status: to, ...extra },
  });
  if (res.count === 0) {
    const cur = await prisma.questionnaire.findFirst({
      where: { id, deletedAt: null },
      select: { status: true },
    });
    if (!cur) throw notFound("Questionnaire");
    throw conflict(`This action is not available while the questionnaire is ${cur.status.toLowerCase()}.`);
  }
  await writeAudit({
    actorId: ctx.userId,
    action,
    resource: "Questionnaire",
    resourceId: id,
    metadata: { from, to },
  });
}

export async function publishQuestionnaire(ctx: AuthContext, id: string) {
  requirePermission(ctx, "questionnaire.publish");
  const q = await loadFull(id);
  if (q.status !== "DRAFT") throw conflict("Only a draft can be published.");
  const version = q.latestVersion + 1;
  const definition = buildDefinition(q, version);
  const problems = publishProblems(definition);
  if (problems.length) throw invalid(problems[0], { _: problems });

  await prisma.$transaction(async (tx) => {
    const res = await tx.questionnaire.updateMany({
      where: { id, status: "DRAFT", latestVersion: q.latestVersion },
      data: { status: "PUBLISHED", latestVersion: version },
    });
    if (res.count === 0) throw conflict("The questionnaire changed while publishing. Please try again.");
    await tx.questionnaireVersion.create({
      data: {
        questionnaireId: id,
        version,
        definition: definition as unknown as Prisma.InputJsonValue,
        publishedById: ctx.userId,
      },
    });
  });
  await writeAudit({
    actorId: ctx.userId,
    action: "QUESTIONNAIRE_PUBLISHED",
    resource: "Questionnaire",
    resourceId: id,
    metadata: { version },
  });
  return { version };
}

/** Two ACTIVE questionnaires may not claim the same location. */
async function assertNoActiveOverlap(
  id: string,
  targets: { districtId: string | null; branchId: string | null; departmentId: string | null }[],
) {
  for (const t of targets) {
    const clash = await prisma.questionnaireAssignment.findFirst({
      where: {
        questionnaireId: { not: id },
        districtId: t.districtId,
        branchId: t.branchId,
        departmentId: t.departmentId,
        questionnaire: { status: "ACTIVE", deletedAt: null },
      },
    });
    if (clash)
      throw conflict(
        "Another active questionnaire is already assigned to one of these locations. Pause or close it first.",
      );
  }
}

export async function activateQuestionnaire(ctx: AuthContext, id: string) {
  requirePermission(ctx, "questionnaire.publish");
  const q = await prisma.questionnaire.findFirst({
    where: { id, deletedAt: null },
    include: { assignments: true },
  });
  if (!q) throw notFound("Questionnaire");
  if (q.assignments.length === 0)
    throw invalid("Assign the questionnaire to at least one location before activating it.");
  for (const a of q.assignments) await requirePermissionOnAssignment(ctx, a);
  await assertNoActiveOverlap(id, q.assignments);
  await transition(ctx, id, ["PUBLISHED", "PAUSED"], "ACTIVE", "QUESTIONNAIRE_ACTIVATED");
}

export async function pauseQuestionnaire(ctx: AuthContext, id: string) {
  requirePermission(ctx, "questionnaire.publish");
  await transition(ctx, id, ["ACTIVE"], "PAUSED", "QUESTIONNAIRE_PAUSED");
}

export async function closeQuestionnaire(ctx: AuthContext, id: string) {
  requirePermission(ctx, "questionnaire.publish");
  await transition(ctx, id, ["PUBLISHED", "ACTIVE", "PAUSED"], "CLOSED", "QUESTIONNAIRE_CLOSED");
}

/** Back to DRAFT so it can be edited and published as a new version. Not allowed while ACTIVE. */
export async function reopenQuestionnaire(ctx: AuthContext, id: string) {
  requirePermission(ctx, "questionnaire.update");
  await transition(ctx, id, ["PUBLISHED", "PAUSED"], "DRAFT", "QUESTIONNAIRE_REOPENED");
}

export async function deleteQuestionnaire(ctx: AuthContext, id: string) {
  requirePermission(ctx, "questionnaire.delete");
  const q = await prisma.questionnaire.findFirst({ where: { id, deletedAt: null } });
  if (!q) throw notFound("Questionnaire");
  if (q.status === "ACTIVE") throw conflict("An active questionnaire cannot be deleted. Close it first.");
  await prisma.$transaction([
    prisma.questionnaireAssignment.deleteMany({ where: { questionnaireId: id } }),
    prisma.questionnaire.update({ where: { id }, data: { deletedAt: new Date() } }),
  ]);
  await writeAudit({
    actorId: ctx.userId,
    action: "QUESTIONNAIRE_DELETED",
    resource: "Questionnaire",
    resourceId: id,
  });
}

// ───────────────────────── Assignments ─────────────────────────

async function requirePermissionOnAssignment(
  ctx: AuthContext,
  a: { districtId: string | null; branchId: string | null; departmentId: string | null },
) {
  const scopeType: ScopeType = a.branchId
    ? "BRANCH"
    : a.departmentId
      ? "DEPARTMENT"
      : a.districtId
        ? "DISTRICT"
        : "ALL";
  requirePermissionOn(ctx, "questionnaire.publish", await resolveTarget({ scopeType, ...a }));
}

/** Replaces where this questionnaire is shown. The actor must control every location involved. */
export async function setAssignments(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "questionnaire.publish");
  const targets: AssignmentTarget[] = parse(assignmentsSchema, input);
  const q = await prisma.questionnaire.findFirst({
    where: { id, deletedAt: null },
    include: { assignments: true },
  });
  if (!q) throw notFound("Questionnaire");
  if (q.status === "CLOSED") throw conflict("A closed questionnaire cannot be reassigned.");

  const rows = targets.map((t) => ({
    questionnaireId: id,
    districtId: t.scopeType === "DISTRICT" ? t.id! : null,
    branchId: t.scopeType === "BRANCH" ? t.id! : null,
    departmentId: t.scopeType === "DEPARTMENT" ? t.id! : null,
  }));
  const unique = new Set(rows.map((r) => `${r.districtId}|${r.branchId}|${r.departmentId}`));
  if (unique.size !== rows.length) throw invalid("Each location can only be listed once.");

  // Locations being added or removed both need authority (you cannot strip another region's questionnaire).
  for (const a of [...q.assignments, ...rows]) await requirePermissionOnAssignment(ctx, a);
  if (q.status === "ACTIVE") await assertNoActiveOverlap(id, rows);

  await prisma.$transaction([
    prisma.questionnaireAssignment.deleteMany({ where: { questionnaireId: id } }),
    prisma.questionnaireAssignment.createMany({ data: rows }),
  ]);
  await writeAudit({
    actorId: ctx.userId,
    action: "QUESTIONNAIRE_ASSIGNED",
    resource: "Questionnaire",
    resourceId: id,
    metadata: { targets },
  });
}

// ───────────────────────── Resolution (used by the public form) ─────────────────────────

export interface LocationRef {
  districtId?: string | null;
  branchId?: string | null;
  departmentId?: string | null;
}

/**
 * The questionnaire currently shown at a location: the most specific ACTIVE assignment wins
 * (branch/department → district → bank-wide). Returns the latest published snapshot.
 * Unauthenticated by design — it is the public path; it exposes only published definitions.
 */
export async function resolveActiveQuestionnaire(loc: LocationRef) {
  let districtId = loc.districtId ?? null;
  if (loc.branchId && !districtId) {
    districtId =
      (await prisma.branch.findUnique({ where: { id: loc.branchId }, select: { districtId: true } }))
        ?.districtId ?? null;
  }
  if (loc.departmentId && !districtId) {
    districtId =
      (await prisma.department.findUnique({ where: { id: loc.departmentId }, select: { districtId: true } }))
        ?.districtId ?? null;
  }

  const candidates = await prisma.questionnaireAssignment.findMany({
    where: {
      questionnaire: { status: "ACTIVE", deletedAt: null, latestVersion: { gt: 0 } },
      OR: [
        ...(loc.branchId ? [{ branchId: loc.branchId }] : []),
        ...(loc.departmentId ? [{ departmentId: loc.departmentId }] : []),
        ...(districtId ? [{ districtId, branchId: null, departmentId: null }] : []),
        { districtId: null, branchId: null, departmentId: null },
      ],
    },
  });
  const rank = (a: (typeof candidates)[number]) => (a.branchId || a.departmentId ? 0 : a.districtId ? 1 : 2);
  const best = candidates.sort((a, b) => rank(a) - rank(b))[0];
  if (!best) return null;

  const q = await prisma.questionnaire.findUniqueOrThrow({ where: { id: best.questionnaireId } });
  const version = await prisma.questionnaireVersion.findUnique({
    where: { questionnaireId_version: { questionnaireId: q.id, version: q.latestVersion } },
  });
  if (!version) return null;
  return {
    questionnaireId: q.id,
    versionId: version.id,
    definition: version.definition as unknown as QuestionnaireDefinition,
  };
}

export { DEFAULT_LOCALE };
