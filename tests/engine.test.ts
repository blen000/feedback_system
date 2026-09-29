import { describe, expect, it } from "vitest";
import { normalizeRating, sentimentOf, validateSubmission, visibleRefs } from "@/lib/questionnaire/engine";
import type { DefinitionQuestion, QuestionnaireDefinition } from "@/lib/questionnaire/types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function q(
  n: number,
  over: Partial<DefinitionQuestion> & Pick<DefinitionQuestion, "type">,
): DefinitionQuestion {
  return {
    ref: id(n),
    text: { en: `Q${n}` },
    required: false,
    isPrimaryRating: false,
    config: {},
    options: [],
    visibility: null,
    ...over,
  };
}
const opts = (...v: string[]) => v.map((value) => ({ value, label: { en: value } }));
const def = (questions: DefinitionQuestion[]): QuestionnaireDefinition => ({
  questionnaireId: id(999),
  version: 1,
  defaultLocale: "en",
  locales: ["en"],
  collectContact: false,
  title: { en: "T" },
  description: {},
  questions,
});

describe("answer validation per question type", () => {
  it("YES_NO accepts only yes/no", () => {
    const d = def([q(1, { type: "YES_NO", required: true })]);
    expect(validateSubmission(d, { [id(1)]: "yes" }).ok).toBe(true);
    expect(validateSubmission(d, { [id(1)]: "maybe" }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: true }).ok).toBe(false);
  });

  it("STAR_RATING respects the configured scale", () => {
    const d = def([q(1, { type: "STAR_RATING", config: { scale: 5 } })]);
    expect(validateSubmission(d, { [id(1)]: 5 }).ok).toBe(true);
    expect(validateSubmission(d, { [id(1)]: 6 }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: 0 }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: 3.5 }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: "5" }).ok).toBe(false);
  });

  it("NPS is an integer 0–10", () => {
    const d = def([q(1, { type: "NPS" })]);
    for (const v of [0, 7, 10]) expect(validateSubmission(d, { [id(1)]: v }).ok).toBe(true);
    for (const v of [-1, 11, 4.2]) expect(validateSubmission(d, { [id(1)]: v }).ok).toBe(false);
  });

  it("EMOJI_RATING is 1–5", () => {
    const d = def([q(1, { type: "EMOJI_RATING" })]);
    expect(validateSubmission(d, { [id(1)]: 5 }).ok).toBe(true);
    expect(validateSubmission(d, { [id(1)]: 6 }).ok).toBe(false);
  });

  it("NUMBER validates numeric type, bounds and integer flag", () => {
    const d = def([q(1, { type: "NUMBER", config: { min: 0, max: 120, integer: true } })]);
    expect(validateSubmission(d, { [id(1)]: 15 }).ok).toBe(true);
    expect(validateSubmission(d, { [id(1)]: "15" }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: -1 }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: 121 }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: 1.5 }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: Infinity }).ok).toBe(false);
  });

  it("SHORT_TEXT / LONG_TEXT trim, enforce length and reject non-strings", () => {
    const d = def([q(1, { type: "SHORT_TEXT", config: { maxLength: 10 } }), q(2, { type: "LONG_TEXT" })]);
    const good = validateSubmission(d, { [id(1)]: "  hello  ", [id(2)]: "long text" });
    expect(good.ok && good.answers.find((a) => a.questionRef === id(1))?.valueText).toBe("hello");
    expect(validateSubmission(d, { [id(1)]: "x".repeat(11) }).ok).toBe(false);
    expect(validateSubmission(d, { [id(2)]: "x".repeat(2001) }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: 42 }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: { $ne: "" } }).ok).toBe(false);
  });

  it("SINGLE_CHOICE only accepts a defined option value", () => {
    const d = def([q(1, { type: "SINGLE_CHOICE", options: opts("a", "b") })]);
    expect(validateSubmission(d, { [id(1)]: "a" }).ok).toBe(true);
    expect(validateSubmission(d, { [id(1)]: "zzz" }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: ["a"] }).ok).toBe(false);
  });

  it("MULTIPLE_CHOICE validates every value, dedupes and honours limits", () => {
    const d = def([
      q(1, { type: "MULTIPLE_CHOICE", options: opts("a", "b", "c"), config: { maxSelect: 2 } }),
    ]);
    const ok = validateSubmission(d, { [id(1)]: ["a", "a", "b"] });
    expect(ok.ok && ok.answers[0].valueOptions).toEqual(["a", "b"]);
    expect(validateSubmission(d, { [id(1)]: ["a", "b", "c"] }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: ["a", "nope"] }).ok).toBe(false);
    expect(validateSubmission(d, { [id(1)]: "a" }).ok).toBe(false);
  });
});

describe("required / malformed", () => {
  it("flags missing required answers and accepts missing optional ones", () => {
    const d = def([q(1, { type: "YES_NO", required: true }), q(2, { type: "LONG_TEXT" })]);
    const r = validateSubmission(d, {});
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors)).toEqual([id(1)]);
    expect(validateSubmission(d, { [id(1)]: "no" }).ok).toBe(true);
  });

  it("treats empty string / empty array as unanswered", () => {
    const d = def([
      q(1, { type: "LONG_TEXT", required: true }),
      q(2, { type: "MULTIPLE_CHOICE", required: true, options: opts("a") }),
    ]);
    const r = validateSubmission(d, { [id(1)]: "", [id(2)]: [] });
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual([id(1), id(2)].sort());
  });

  it("rejects answers for unknown questions", () => {
    const d = def([q(1, { type: "YES_NO" })]);
    const r = validateSubmission(d, { [id(1)]: "yes", [id(77)]: "yes" });
    expect(r.ok).toBe(false);
  });
});

describe("conditional questions", () => {
  // Q1 satisfied? yes/no → Q2 "main problem" only if Q1 = no → Q3 "explain" only if Q2 answered
  const d = def([
    q(1, { type: "YES_NO", required: true }),
    q(2, {
      type: "SINGLE_CHOICE",
      required: true,
      options: opts("wait", "staff", "other"),
      visibility: { match: "all", rules: [{ questionRef: id(1), operator: "equals", value: "no" }] },
    }),
    q(3, {
      type: "LONG_TEXT",
      required: true,
      visibility: { match: "all", rules: [{ questionRef: id(2), operator: "answered" }] },
    }),
  ]);

  it("hides dependent questions when the condition is not met", () => {
    expect([...visibleRefs(d, { [id(1)]: "yes" })]).toEqual([id(1)]);
    const r = validateSubmission(d, { [id(1)]: "yes" });
    expect(r.ok && r.answers.map((a) => a.questionRef)).toEqual([id(1)]);
  });

  it("requires visible dependent questions", () => {
    const r = validateSubmission(d, { [id(1)]: "no" });
    expect(!r.ok && Object.keys(r.errors)).toEqual([id(2)]);
    const r2 = validateSubmission(d, { [id(1)]: "no", [id(2)]: "wait" });
    expect(!r2.ok && Object.keys(r2.errors)).toEqual([id(3)]);
    expect(validateSubmission(d, { [id(1)]: "no", [id(2)]: "wait", [id(3)]: "Long queue" }).ok).toBe(true);
  });

  it("drops (never stores) answers submitted for hidden questions", () => {
    const r = validateSubmission(d, { [id(1)]: "yes", [id(2)]: "staff", [id(3)]: "sneaky" });
    expect(r.ok && r.answers.map((a) => a.questionRef)).toEqual([id(1)]);
  });

  it("chains: hiding a parent hides its dependants even if the child answer is present", () => {
    const vis = visibleRefs(d, { [id(1)]: "yes", [id(2)]: "staff" });
    expect(vis.has(id(3))).toBe(false);
  });

  it("supports any/all, in, gte/lte and multi-select answers", () => {
    const d2 = def([
      q(1, { type: "NPS" }),
      q(2, { type: "MULTIPLE_CHOICE", options: opts("a", "b") }),
      q(3, {
        type: "SHORT_TEXT",
        visibility: {
          match: "any",
          rules: [
            { questionRef: id(1), operator: "lte", value: 6 },
            { questionRef: id(2), operator: "in", value: ["b"] },
          ],
        },
      }),
    ]);
    expect(visibleRefs(d2, { [id(1)]: 9 }).has(id(3))).toBe(false);
    expect(visibleRefs(d2, { [id(1)]: 5 }).has(id(3))).toBe(true);
    expect(visibleRefs(d2, { [id(1)]: 9, [id(2)]: ["a", "b"] }).has(id(3))).toBe(true);
  });
});

describe("overall rating", () => {
  it("normalizes the primary rating onto 1–5 and derives sentiment", () => {
    const stars = q(1, { type: "STAR_RATING", isPrimaryRating: true, config: { scale: 10 } });
    expect(normalizeRating(stars, 10)).toBe(5);
    expect(normalizeRating(stars, 5)).toBe(2.5);
    expect(normalizeRating(q(2, { type: "NPS" }), 0)).toBe(1);
    expect(normalizeRating(q(2, { type: "NPS" }), 10)).toBe(5);
    expect(sentimentOf(4.5)).toBe("POSITIVE");
    expect(sentimentOf(3)).toBe("NEUTRAL");
    expect(sentimentOf(2)).toBe("NEGATIVE");

    const r = validateSubmission(def([q(1, { type: "STAR_RATING", isPrimaryRating: true })]), { [id(1)]: 4 });
    expect(r.ok && r.overallRating).toBe(4);
    expect(r.ok && r.sentiment).toBe("POSITIVE");
  });

  it("is null when no primary rating exists or it is unanswered", () => {
    const r = validateSubmission(def([q(1, { type: "STAR_RATING" })]), { [id(1)]: 4 });
    expect(r.ok && r.overallRating).toBeNull();
  });
});
