import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import type { QuestionnaireDefinition } from "@/lib/questionnaire/types";
import { createQuestion, deleteQuestion, updateQuestion } from "@/server/services/questions";
import {
  activateQuestionnaire,
  closeQuestionnaire,
  createQuestionnaire,
  deleteQuestionnaire,
  getQuestionnaireEditor,
  pauseQuestionnaire,
  previewDefinition,
  publishQuestionnaire,
  reopenQuestionnaire,
  resolveActiveQuestionnaire,
  saveDraft,
  setAssignments,
} from "@/server/services/questionnaires";
import { actorWith, cleanup, makeBranch, makeDistrict } from "./helpers";

const ALL = [
  "questionnaire.view",
  "questionnaire.create",
  "questionnaire.update",
  "questionnaire.publish",
  "questionnaire.delete",
  "question.view",
  "question.create",
  "question.update",
  "question.delete",
];

let d1: { id: string };
let d2: { id: string };
let b1: { id: string };
let editor: Awaited<ReturnType<typeof actorWith>>;

beforeAll(async () => {
  d1 = await makeDistrict("QD1");
  d2 = await makeDistrict("QD2");
  b1 = await makeBranch(d1.id, "QB1");
  editor = await actorWith({ permissions: ALL });
});
afterAll(cleanup);

// ── builders ──
const meta = (title = "TQ Survey") => ({
  title: { en: title, am: "የዳሰሳ ጥናት" },
  defaultLocale: "en",
  locales: ["en", "am"],
  collectContact: false,
});

async function mkStar(text = "TQ How was service?") {
  return (
    await createQuestion(editor, {
      type: "STAR_RATING",
      text: { en: text, am: "አገልግሎቱ እንዴት ነበር?" },
      config: { scale: 5 },
    })
  ).id;
}
async function mkYesNo(text = "TQ Resolved?") {
  return (await createQuestion(editor, { type: "YES_NO", text: { en: text } })).id;
}
async function mkChoice(text = "TQ Problem?") {
  return (
    await createQuestion(editor, {
      type: "SINGLE_CHOICE",
      text: { en: text },
      options: [{ label: { en: "Waiting" } }, { label: { en: "Staff" } }, { label: { en: "Other" } }],
    })
  ).id;
}
const item = (questionId: string, over: Record<string, unknown> = {}) => ({
  ref: randomUUID(),
  questionId,
  isRequired: false,
  isActive: true,
  isPrimaryRating: false,
  visibility: null,
  ...over,
});

async function draftWithQuestions() {
  const { id } = await createQuestionnaire(editor, meta());
  const star = await mkStar();
  const yn = await mkYesNo();
  const items = [item(star, { isRequired: true, isPrimaryRating: true }), item(yn)];
  await saveDraft(editor, id, { meta: meta(), questions: items });
  return { id, star, yn, items };
}

async function published() {
  const d = await draftWithQuestions();
  await publishQuestionnaire(editor, d.id);
  return d;
}

const defOf = async (id: string, version: number) =>
  (
    await prisma.questionnaireVersion.findUniqueOrThrow({
      where: { questionnaireId_version: { questionnaireId: id, version } },
    })
  ).definition as unknown as QuestionnaireDefinition;

describe("question library", () => {
  it("creates every question type with translations", async () => {
    const types = [
      { type: "YES_NO" },
      { type: "STAR_RATING", config: { scale: 5 } },
      { type: "SINGLE_CHOICE", options: [{ label: { en: "A" } }, { label: { en: "B" } }] },
      { type: "MULTIPLE_CHOICE", options: [{ label: { en: "A" } }, { label: { en: "B" } }] },
      { type: "SHORT_TEXT" },
      { type: "LONG_TEXT" },
      { type: "NUMBER", config: { min: 0 } },
      { type: "NPS" },
      { type: "EMOJI_RATING" },
    ];
    for (const t of types) {
      await expect(
        createQuestion(editor, { ...t, text: { en: `TQ ${t.type}`, am: "ጥያቄ" } }),
      ).resolves.toBeTruthy();
    }
  });

  it("validates: text required, choice needs 2+ options, no options on other types", async () => {
    await expect(createQuestion(editor, { type: "YES_NO", text: {} })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      createQuestion(editor, {
        type: "SINGLE_CHOICE",
        text: { en: "TQ x" },
        options: [{ label: { en: "Only one" } }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createQuestion(editor, {
        type: "YES_NO",
        text: { en: "TQ x" },
        options: [{ label: { en: "A" } }, { label: { en: "B" } }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createQuestion(editor, { type: "NUMBER", text: { en: "TQ x" }, config: { min: 10, max: 1 } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps option values stable on edit and refuses to change the type", async () => {
    const id = await mkChoice();
    const before = await prisma.questionOption.findMany({
      where: { questionId: id },
      orderBy: { sortOrder: "asc" },
    });
    await updateQuestion(editor, id, {
      type: "SINGLE_CHOICE",
      text: { en: "TQ Problem? (edited)" },
      options: before.map((o, i) => ({ value: o.value, label: { en: `Label ${i}` } })).reverse(),
    });
    const after = await prisma.questionOption.findMany({
      where: { questionId: id },
      orderBy: { sortOrder: "asc" },
    });
    expect(after.map((o) => o.value)).toEqual(before.map((o) => o.value).reverse());
    await expect(
      updateQuestion(editor, id, { type: "LONG_TEXT", text: { en: "TQ changed" } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cannot delete a question that a questionnaire uses", async () => {
    const d = await draftWithQuestions();
    await expect(deleteQuestion(editor, d.star)).rejects.toMatchObject({ code: "CONFLICT" });
    const unused = await mkYesNo("TQ unused");
    await expect(deleteQuestion(editor, unused)).resolves.toBeUndefined();
  });
});

describe("draft editing", () => {
  it("saves order, flags and translations, and keeps refs stable across saves", async () => {
    const d = await draftWithQuestions();
    const ed1 = await getQuestionnaireEditor(editor, d.id);
    expect(ed1.questions.map((q) => q.ref)).toEqual(d.items.map((i) => i.ref));
    expect(ed1.meta.title.am).toBe("የዳሰሳ ጥናት");

    // reorder (swap) and save again
    await saveDraft(editor, d.id, { meta: meta("TQ Renamed"), questions: [...d.items].reverse() });
    const ed2 = await getQuestionnaireEditor(editor, d.id);
    expect(ed2.questions.map((q) => q.ref)).toEqual([...d.items].reverse().map((i) => i.ref));
    expect(ed2.meta.title.en).toBe("TQ Renamed");
  });

  it("rejects: forward-referencing conditions, duplicate item refs, two overall ratings, bad primary type", async () => {
    const { id } = await createQuestionnaire(editor, meta());
    const a = item(await mkYesNo("TQ a"));
    const b = item(await mkChoice("TQ b"));

    await expect(
      saveDraft(editor, id, {
        meta: meta(),
        questions: [
          item(b.questionId, {
            visibility: { match: "all", rules: [{ questionRef: a.ref, operator: "equals", value: "no" }] },
          }),
          a,
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" }); // depends on a later question

    await expect(saveDraft(editor, id, { meta: meta(), questions: [a, { ...a }] })).rejects.toMatchObject({
      code: "VALIDATION",
    }); // the same item ref twice is a malformed request
    await expect(
      saveDraft(editor, id, { meta: meta(), questions: [{ ...a, isPrimaryRating: true }, b] }),
    ).rejects.toMatchObject({ code: "VALIDATION" }); // yes/no is not a rating
    const s1 = item(await mkStar("TQ s1"), { isPrimaryRating: true });
    const s2 = item(await mkStar("TQ s2"), { isPrimaryRating: true });
    await expect(saveDraft(editor, id, { meta: meta(), questions: [s1, s2] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("allows as many questions as needed, including the same question or type repeated", async () => {
    const { id } = await createQuestionnaire(editor, meta());
    const rating = await mkStar("TQ repeatable rating");
    const choice = await mkChoice("TQ repeatable choice");
    // 3× the same rating question + 3× the same choice question + 6 more distinct ratings = 12 items
    const items = [
      ...[1, 2, 3].map(() => item(rating, { isRequired: true })),
      ...[1, 2, 3].map(() => item(choice)),
      ...(await Promise.all([1, 2, 3, 4, 5, 6].map((n) => mkStar(`TQ rating ${n}`)))).map((q) => item(q)),
    ];
    await saveDraft(editor, id, { meta: meta(), questions: items });
    const ed = await getQuestionnaireEditor(editor, id);
    expect(ed.questions).toHaveLength(12);
    expect(new Set(ed.questions.map((q) => q.ref)).size).toBe(12); // each use has its own reference

    await publishQuestionnaire(editor, id);
    const def = await defOf(id, 1);
    expect(def.questions).toHaveLength(12);
    expect(new Set(def.questions.map((q) => q.ref)).size).toBe(12);

    // each use is answered independently: unrelated answers to the repeated question are kept apart
    const { validateSubmission } = await import("@/lib/questionnaire/engine");
    const ratings = def.questions.filter((q) => q.type === "STAR_RATING");
    const answers: Record<string, unknown> = Object.fromEntries(ratings.map((q, i) => [q.ref, (i % 5) + 1]));
    const res = validateSubmission(def, answers);
    expect(res.ok && res.answers).toHaveLength(9);
    expect(res.ok && new Set(res.answers.map((a) => a.questionRef)).size).toBe(9);
    // a required repeated question that is left blank fails only for that use
    const missing = validateSubmission(def, { [ratings[0].ref]: 4 });
    expect(!missing.ok && Object.keys(missing.errors).sort()).toEqual(
      [ratings[1].ref, ratings[2].ref].sort(),
    );
  });

  it("supports up to 200 questions and rejects more", async () => {
    const { id } = await createQuestionnaire(editor, meta());
    const q = await mkYesNo("TQ bulk");
    const many = (n: number) => Array.from({ length: n }, () => item(q));
    await expect(saveDraft(editor, id, { meta: meta(), questions: many(200) })).resolves.toBeUndefined();
    await expect(saveDraft(editor, id, { meta: meta(), questions: many(201) })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("refuses to adopt an item ref that belongs to another questionnaire", async () => {
    const other = await draftWithQuestions();
    const { id } = await createQuestionnaire(editor, meta());
    await expect(
      saveDraft(editor, id, { meta: meta(), questions: [item(other.yn, { ref: other.items[1].ref })] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("supports conditional visibility that survives a round-trip", async () => {
    const { id } = await createQuestionnaire(editor, meta());
    const sat = item(await mkYesNo("TQ satisfied?"));
    const why = item(await mkChoice("TQ why not?"), {
      visibility: { match: "all", rules: [{ questionRef: sat.ref, operator: "equals", value: "no" }] },
    });
    await saveDraft(editor, id, { meta: meta(), questions: [sat, why] });
    const ed = await getQuestionnaireEditor(editor, id);
    expect(ed.questions[1].visibility?.rules[0]).toMatchObject({
      questionRef: sat.ref,
      operator: "equals",
      value: "no",
    });
    // clearing the condition removes it
    await saveDraft(editor, id, { meta: meta(), questions: [sat, { ...why, visibility: null }] });
    expect((await getQuestionnaireEditor(editor, id)).questions[1].visibility).toBeNull();
  });

  it("previews without creating any feedback", async () => {
    const d = await draftWithQuestions();
    const before = await prisma.feedbackSubmission.count();
    const def = await previewDefinition(editor, d.id);
    expect(def.questions).toHaveLength(2);
    expect(def.version).toBe(0);
    expect(await prisma.feedbackSubmission.count()).toBe(before);
  });
});

describe("lifecycle and versioning", () => {
  it("publishing needs a valid questionnaire", async () => {
    const { id } = await createQuestionnaire(editor, meta());
    await expect(publishQuestionnaire(editor, id)).rejects.toMatchObject({ code: "VALIDATION" }); // no questions
    // an item with no default-language text cannot exist (validated), but inactive-only questionnaires fail
    await saveDraft(editor, id, {
      meta: meta(),
      questions: [item(await mkYesNo("TQ inactive"), { isActive: false })],
    });
    await expect(publishQuestionnaire(editor, id)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("publish freezes an immutable snapshot; later edits never change it", async () => {
    const d = await published();
    const v1 = await defOf(d.id, 1);
    expect(v1.questions).toHaveLength(2);
    expect(v1.questions[0].text.en).toBe("TQ How was service?");

    // edit the shared library question after publishing …
    await updateQuestion(editor, d.star, {
      type: "STAR_RATING",
      text: { en: "TQ Totally different wording" },
      config: { scale: 5 },
    });
    expect((await defOf(d.id, 1)).questions[0].text.en).toBe("TQ How was service?");

    // … reopen, change the questionnaire, publish v2: v1 is untouched
    await reopenQuestionnaire(editor, d.id);
    await saveDraft(editor, d.id, { meta: meta("TQ Survey v2"), questions: [d.items[0]] });
    await publishQuestionnaire(editor, d.id);
    const v2 = await defOf(d.id, 2);
    expect(v2.questions).toHaveLength(1);
    expect(v2.questions[0].text.en).toBe("TQ Totally different wording");
    const v1After = await defOf(d.id, 1);
    expect(v1After.questions).toHaveLength(2);
    expect(v1After.title.en).toBe("TQ Survey");
    // refs are stable across versions
    expect(v2.questions[0].ref).toBe(v1After.questions[0].ref);
  });

  it("only a draft is editable", async () => {
    const d = await published();
    await expect(saveDraft(editor, d.id, { meta: meta(), questions: d.items })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(publishQuestionnaire(editor, d.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("walks DRAFT → PUBLISHED → ACTIVE → PAUSED → ACTIVE → CLOSED and enforces the order", async () => {
    const d = await published();
    const status = async () => (await prisma.questionnaire.findUniqueOrThrow({ where: { id: d.id } })).status;
    expect(await status()).toBe("PUBLISHED");

    await expect(activateQuestionnaire(editor, d.id)).rejects.toMatchObject({ code: "VALIDATION" }); // no location yet
    await setAssignments(editor, d.id, [{ scopeType: "DISTRICT", id: d1.id }]);
    await activateQuestionnaire(editor, d.id);
    expect(await status()).toBe("ACTIVE");

    await expect(reopenQuestionnaire(editor, d.id)).rejects.toMatchObject({ code: "CONFLICT" }); // must pause first
    await expect(deleteQuestionnaire(editor, d.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await pauseQuestionnaire(editor, d.id);
    expect(await status()).toBe("PAUSED");
    await activateQuestionnaire(editor, d.id);
    await closeQuestionnaire(editor, d.id);
    expect(await status()).toBe("CLOSED");

    await expect(activateQuestionnaire(editor, d.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(reopenQuestionnaire(editor, d.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(pauseQuestionnaire(editor, d.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await setAssignments(editor, d.id, []).catch((e) => expect(e.code).toBe("CONFLICT"));
  });

  it("writes audit entries for lifecycle changes", async () => {
    const d = await published();
    await setAssignments(editor, d.id, [{ scopeType: "BRANCH", id: b1.id }]);
    await activateQuestionnaire(editor, d.id);
    await pauseQuestionnaire(editor, d.id);
    const actions = (await prisma.auditLog.findMany({ where: { resourceId: d.id } })).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "QUESTIONNAIRE_CREATED",
        "QUESTIONNAIRE_PUBLISHED",
        "QUESTIONNAIRE_ACTIVATED",
        "QUESTIONNAIRE_PAUSED",
      ]),
    );
  });
});

describe("assignments and resolution", () => {
  it("two ACTIVE questionnaires cannot share a location", async () => {
    const a = await published();
    const b = await published();
    await setAssignments(editor, a.id, [{ scopeType: "DISTRICT", id: d2.id }]);
    await setAssignments(editor, b.id, [{ scopeType: "DISTRICT", id: d2.id }]);
    await activateQuestionnaire(editor, a.id);
    await expect(activateQuestionnaire(editor, b.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await pauseQuestionnaire(editor, a.id);
    await expect(activateQuestionnaire(editor, b.id)).resolves.toBeUndefined();
  });

  it("resolves the most specific ACTIVE questionnaire for a location, and only ACTIVE ones", async () => {
    const dist = await published();
    const branch = await published();
    await setAssignments(editor, dist.id, [{ scopeType: "DISTRICT", id: d1.id }]);
    await setAssignments(editor, branch.id, [{ scopeType: "BRANCH", id: b1.id }]);
    await activateQuestionnaire(editor, dist.id);

    // only the district one is active: the branch inherits it
    expect((await resolveActiveQuestionnaire({ branchId: b1.id }))?.questionnaireId).toBe(dist.id);

    // once the branch-specific one is active it wins for that branch, not for other branches
    await activateQuestionnaire(editor, branch.id);
    expect((await resolveActiveQuestionnaire({ branchId: b1.id }))?.questionnaireId).toBe(branch.id);
    const sibling = await makeBranch(d1.id, "QB sibling");
    expect((await resolveActiveQuestionnaire({ branchId: sibling.id }))?.questionnaireId).toBe(dist.id);

    // paused questionnaires are never served
    await pauseQuestionnaire(editor, branch.id);
    expect((await resolveActiveQuestionnaire({ branchId: b1.id }))?.questionnaireId).toBe(dist.id);
    await pauseQuestionnaire(editor, dist.id);
    expect(await resolveActiveQuestionnaire({ branchId: b1.id })).toBeNull();
  });

  it("returns the latest published snapshot, not the working copy", async () => {
    const d = await published();
    await setAssignments(editor, d.id, [{ scopeType: "DISTRICT", id: d1.id }]);
    await activateQuestionnaire(editor, d.id);
    const res = await resolveActiveQuestionnaire({ districtId: d1.id });
    expect(res?.definition.version).toBe(1);
    expect(res?.definition.questions).toHaveLength(2);
    await pauseQuestionnaire(editor, d.id);
  });
});

describe("authorization", () => {
  it("denies users without the relevant permissions", async () => {
    const viewer = await actorWith({ permissions: ["questionnaire.view", "question.view"] });
    const d = await published();
    await expect(createQuestionnaire(viewer, meta())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveDraft(viewer, d.id, { meta: meta(), questions: [] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(publishQuestionnaire(viewer, d.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(activateQuestionnaire(viewer, d.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteQuestionnaire(viewer, d.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createQuestion(viewer, { type: "YES_NO", text: { en: "TQ no" } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      getQuestionnaireEditor(await actorWith({ permissions: ["dashboard.view"] }), d.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a district-scoped publisher can only assign locations inside their district", async () => {
    const dm = await actorWith({
      permissions: ["questionnaire.publish", "questionnaire.view"],
      scopeType: "DISTRICT",
      districtId: d1.id,
    });
    const d = await published();
    await expect(setAssignments(dm, d.id, [{ scopeType: "DISTRICT", id: d2.id }])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(setAssignments(dm, d.id, [{ scopeType: "ALL" }])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(setAssignments(dm, d.id, [{ scopeType: "BRANCH", id: b1.id }])).resolves.toBeUndefined();
    // and cannot strip assignments outside their reach
    await setAssignments(editor, d.id, [{ scopeType: "DISTRICT", id: d2.id }]);
    await expect(setAssignments(dm, d.id, [])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("validates assignment input on the server", async () => {
    const d = await published();
    await expect(setAssignments(editor, d.id, [{ scopeType: "BRANCH" }])).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(setAssignments(editor, d.id, [{ scopeType: "ALL", id: d1.id }])).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      setAssignments(editor, d.id, [{ scopeType: "BRANCH", id: randomUUID() }]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
