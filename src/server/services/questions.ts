/**
 * Question library. Editing a library question never affects published questionnaire versions
 * (they hold their own immutable snapshot); it only changes drafts that use it.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { conflict, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/rbac/authorize";
import {
  DEFAULT_LOCALE,
  type Localized,
  type QuestionConfig,
  type QuestionType,
} from "@/lib/questionnaire/types";
import { questionInputSchema, type QuestionInput } from "@/lib/validation/questionnaire";
import { parse } from "@/lib/validation/parse";
import type { Prisma } from "@/generated/prisma/client";

const include = {
  translations: true,
  options: { orderBy: { sortOrder: "asc" as const }, include: { translations: true } },
  _count: { select: { usages: true } },
} satisfies Prisma.QuestionInclude;

type Row = Prisma.QuestionGetPayload<{ include: typeof include }>;

export interface LibraryQuestion {
  id: string;
  type: QuestionType;
  text: Localized;
  description: Localized;
  placeholder: Localized;
  config: QuestionConfig;
  options: { value: string; label: Localized }[];
  isActive: boolean;
  usageCount: number;
}

const byLocale = (rows: { locale: string }[], field: "text" | "description" | "placeholder"): Localized =>
  Object.fromEntries(
    rows.flatMap((r) => {
      const v = (r as unknown as Record<string, string | null>)[field];
      return v ? [[r.locale, v]] : [];
    }),
  );

export function presentQuestion(q: Row): LibraryQuestion {
  return {
    id: q.id,
    type: q.type,
    text: byLocale(q.translations, "text"),
    description: byLocale(q.translations, "description"),
    placeholder: byLocale(q.translations, "placeholder"),
    config: (q.config ?? {}) as QuestionConfig,
    options: q.options
      .filter((o) => o.isActive)
      .map((o) => ({
        value: o.value,
        label: Object.fromEntries(o.translations.map((t) => [t.locale, t.label])),
      })),
    isActive: q.isActive,
    usageCount: q._count.usages,
  };
}

export async function listQuestions(ctx: AuthContext): Promise<LibraryQuestion[]> {
  requirePermission(ctx, "question.view");
  const rows = await prisma.question.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include,
  });
  return rows.map(presentQuestion);
}

function translationRows(input: QuestionInput) {
  const locales = new Set([
    ...Object.keys(input.text),
    ...Object.keys(input.description ?? {}),
    ...Object.keys(input.placeholder ?? {}),
  ]);
  return [...locales]
    .filter((l) => input.text[l])
    .map((locale) => ({
      locale,
      text: input.text[locale],
      description: input.description?.[locale] ?? null,
      placeholder: input.placeholder?.[locale] ?? null,
    }));
}

const newOptionValue = () => `opt_${randomBytes(4).toString("hex")}`;

function optionRows(input: QuestionInput) {
  const used = new Set<string>();
  return input.options.map((o, i) => {
    let value = o.value ?? newOptionValue();
    while (used.has(value)) value = newOptionValue();
    used.add(value);
    return {
      value,
      sortOrder: i,
      translations: { create: Object.entries(o.label).map(([locale, label]) => ({ locale, label })) },
    };
  });
}

export async function createQuestion(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "question.create");
  const data = parse(questionInputSchema, input);
  const q = await prisma.question.create({
    data: {
      type: data.type,
      config: data.config as Prisma.InputJsonValue,
      isActive: data.isActive,
      translations: { create: translationRows(data) },
      options: { create: optionRows(data) },
    },
  });
  await writeAudit({
    actorId: ctx.userId,
    action: "QUESTION_CREATED",
    resource: "Question",
    resourceId: q.id,
    metadata: { type: data.type, text: data.text[DEFAULT_LOCALE] },
  });
  const row = await prisma.question.findUniqueOrThrow({ where: { id: q.id }, include });
  return { id: q.id, question: presentQuestion(row) };
}

export async function updateQuestion(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "question.update");
  const existing = await prisma.question.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("Question");
  const data = parse(questionInputSchema, input);
  // Changing the type would silently reinterpret drafts that use it. Create a new question instead.
  if (data.type !== existing.type)
    throw conflict("A question's type cannot be changed. Create a new question instead.");

  await prisma.$transaction([
    prisma.questionTranslation.deleteMany({ where: { questionId: id } }),
    prisma.questionOption.deleteMany({ where: { questionId: id } }),
    prisma.question.update({
      where: { id },
      data: {
        config: data.config as Prisma.InputJsonValue,
        isActive: data.isActive,
        translations: { create: translationRows(data) },
        options: { create: optionRows(data) },
      },
    }),
  ]);
  await writeAudit({
    actorId: ctx.userId,
    action: "QUESTION_UPDATED",
    resource: "Question",
    resourceId: id,
    metadata: { text: data.text[DEFAULT_LOCALE] },
  });
}

export async function deleteQuestion(ctx: AuthContext, id: string) {
  requirePermission(ctx, "question.delete");
  const existing = await prisma.question.findFirst({
    where: { id, deletedAt: null },
    include: { _count: { select: { usages: true } } },
  });
  if (!existing) throw notFound("Question");
  if (existing._count.usages > 0) {
    throw conflict(
      "This question is used by a questionnaire. Remove it there first, or deactivate it instead.",
    );
  }
  await prisma.question.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await writeAudit({ actorId: ctx.userId, action: "QUESTION_DELETED", resource: "Question", resourceId: id });
}
