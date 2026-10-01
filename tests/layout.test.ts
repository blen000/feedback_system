import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createQuestion } from "@/server/services/questions";
import {
  createQuestionnaire,
  publishQuestionnaire,
  saveDraft,
  previewDefinition,
} from "@/server/services/questionnaires";
import { actorWith, cleanup } from "./helpers";
import { randomUUID } from "node:crypto";

let author: Awaited<ReturnType<typeof actorWith>>;
beforeAll(async () => {
  author = await actorWith({
    permissions: [
      "questionnaire.view",
      "questionnaire.create",
      "questionnaire.update",
      "questionnaire.publish",
      "question.view",
      "question.create",
    ],
  });
});
afterAll(cleanup);

const meta = (layout?: "SCROLL" | "ONE_AT_A_TIME") => ({
  title: { en: "TQ Layout" },
  defaultLocale: "en",
  locales: ["en"],
  collectContact: false,
  ...(layout ? { layout } : {}),
});

describe("customer page layout", () => {
  it("defaults to one question at a time", async () => {
    const { id } = await createQuestionnaire(author, { title: { en: "TQ Layout" }, locales: ["en"] });
    expect((await prisma.questionnaire.findUniqueOrThrow({ where: { id } })).layout).toBe("ONE_AT_A_TIME");
    expect((await previewDefinition(author, id)).layout).toBe("ONE_AT_A_TIME");
  });

  it("can be chosen at creation, changed in the draft, and is frozen into the published version", async () => {
    const { id } = await createQuestionnaire(author, { ...meta("SCROLL") });
    expect((await previewDefinition(author, id)).layout).toBe("SCROLL");

    const q = (await createQuestion(author, { type: "STAR_RATING", text: { en: "TQ rate" } })).id;
    const questions = [{ ref: randomUUID(), questionId: q, isRequired: false, isPrimaryRating: true }];
    await saveDraft(author, id, { meta: meta("ONE_AT_A_TIME"), questions });
    await publishQuestionnaire(author, id);
    const version = await prisma.questionnaireVersion.findFirstOrThrow({ where: { questionnaireId: id } });
    expect((version.definition as { layout: string }).layout).toBe("ONE_AT_A_TIME");
  });

  it("rejects unknown layouts", async () => {
    await expect(createQuestionnaire(author, { ...meta(), layout: "CAROUSEL" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});
