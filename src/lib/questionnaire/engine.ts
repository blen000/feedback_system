/**
 * Pure questionnaire engine: conditional visibility, per-type answer validation and
 * rating normalization. No I/O, so it is shared by the browser (UX) and the server (authority).
 */
import {
  CHOICE_TYPES,
  EMOJI_SCALE,
  RATING_TYPES,
  type DefinitionQuestion,
  type NormalizedAnswer,
  type QuestionnaireDefinition,
  type RawAnswers,
  type Visibility,
  type VisibilityRule,
} from "./types";

const REQUIRED_MSG = "This question is required.";
const INVALID_MSG = "Please check your answer.";

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function evalRule(rule: VisibilityRule, answers: RawAnswers): boolean {
  const a = answers[rule.questionRef];
  switch (rule.operator) {
    case "answered":
      return !isEmpty(a);
    case "equals":
      return Array.isArray(a)
        ? a.includes(rule.value as string)
        : a !== undefined && String(a) === String(rule.value);
    case "not_equals":
      return isEmpty(a)
        ? false
        : Array.isArray(a)
          ? !a.includes(rule.value as string)
          : String(a) !== String(rule.value);
    case "in": {
      const set = (Array.isArray(rule.value) ? rule.value : [rule.value]).map(String);
      return Array.isArray(a)
        ? a.some((x) => set.includes(String(x)))
        : !isEmpty(a) && set.includes(String(a));
    }
    case "gte":
      return typeof a === "number" && typeof rule.value === "number" && a >= rule.value;
    case "lte":
      return typeof a === "number" && typeof rule.value === "number" && a <= rule.value;
  }
}

export function evalVisibility(v: Visibility | null | undefined, answers: RawAnswers): boolean {
  if (!v || v.rules.length === 0) return true;
  return v.match === "any"
    ? v.rules.some((r) => evalRule(r, answers))
    : v.rules.every((r) => evalRule(r, answers));
}

/**
 * Refs of questions currently visible, given the answers so far.
 * Questions are evaluated in order; a question hidden by its own rule is treated as
 * unanswered for the rules of later questions (so chains hide consistently).
 */
export function visibleRefs(
  def: Pick<QuestionnaireDefinition, "questions">,
  answers: RawAnswers,
): Set<string> {
  const visible = new Set<string>();
  const effective: RawAnswers = {};
  for (const q of def.questions) {
    if (evalVisibility(q.visibility, effective)) {
      visible.add(q.ref);
      if (q.ref in answers) effective[q.ref] = answers[q.ref];
    }
  }
  return visible;
}

type Parsed = { ok: true; answer: Omit<NormalizedAnswer, "questionRef"> } | { ok: false; message: string };

const ok = (
  q: DefinitionQuestion,
  v: Partial<Omit<NormalizedAnswer, "questionRef" | "questionType">>,
): Parsed => ({
  ok: true,
  answer: { questionType: q.type, valueText: null, valueNumber: null, valueOptions: [], ...v },
});
const bad = (message = INVALID_MSG): Parsed => ({ ok: false, message });

/** Validates one non-empty raw value against the question's type and configuration. */
export function parseAnswer(q: DefinitionQuestion, raw: unknown): Parsed {
  const cfg = q.config;
  switch (q.type) {
    case "YES_NO":
      return raw === "yes" || raw === "no" ? ok(q, { valueOptions: [raw] }) : bad();

    case "STAR_RATING": {
      const scale = cfg.scale ?? 5;
      return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= scale
        ? ok(q, { valueNumber: raw })
        : bad();
    }
    case "EMOJI_RATING":
      return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= EMOJI_SCALE.length
        ? ok(q, { valueNumber: raw })
        : bad();

    case "NPS":
      return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 10
        ? ok(q, { valueNumber: raw })
        : bad();

    case "NUMBER": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return bad("Enter a valid number.");
      if (cfg.integer && !Number.isInteger(raw)) return bad("Enter a whole number.");
      if (cfg.min !== undefined && raw < cfg.min) return bad(`Must be at least ${cfg.min}.`);
      if (cfg.max !== undefined && raw > cfg.max) return bad(`Must be at most ${cfg.max}.`);
      return ok(q, { valueNumber: raw });
    }

    case "SHORT_TEXT":
    case "LONG_TEXT": {
      if (typeof raw !== "string") return bad();
      const text = raw.trim();
      const max = cfg.maxLength ?? (q.type === "SHORT_TEXT" ? 200 : 2000);
      if (text.length === 0) return bad(REQUIRED_MSG);
      if (text.length > max) return bad(`Please use at most ${max} characters.`);
      if (cfg.minLength && text.length < cfg.minLength)
        return bad(`Please use at least ${cfg.minLength} characters.`);
      return ok(q, { valueText: text });
    }

    case "SINGLE_CHOICE":
      return typeof raw === "string" && q.options.some((o) => o.value === raw)
        ? ok(q, { valueOptions: [raw] })
        : bad();

    case "MULTIPLE_CHOICE": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return bad();
      const values = [...new Set(raw as string[])];
      if (values.some((v) => !q.options.some((o) => o.value === v))) return bad();
      if (cfg.minSelect && values.length < cfg.minSelect) return bad(`Select at least ${cfg.minSelect}.`);
      if (cfg.maxSelect && values.length > cfg.maxSelect) return bad(`Select at most ${cfg.maxSelect}.`);
      return ok(q, { valueOptions: values });
    }
  }
}

/** Maps a rating answer onto a common 1–5 scale for reporting. */
export function normalizeRating(q: DefinitionQuestion, value: number): number {
  switch (q.type) {
    case "STAR_RATING":
      return (value / (q.config.scale ?? 5)) * 5;
    case "EMOJI_RATING":
      return value;
    case "NPS":
      return 1 + (value / 10) * 4;
    default:
      return value;
  }
}

export function sentimentOf(rating: number): "POSITIVE" | "NEUTRAL" | "NEGATIVE" {
  return rating >= 4 ? "POSITIVE" : rating > 2.5 ? "NEUTRAL" : "NEGATIVE";
}

export type SubmissionResult =
  | {
      ok: true;
      answers: NormalizedAnswer[];
      overallRating: number | null;
      sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * Authoritative validation of a submission against a published definition.
 * - unknown question refs are rejected (malformed submission)
 * - answers to hidden questions are dropped, never stored
 * - required checks apply only to visible questions
 */
export function validateSubmission(def: QuestionnaireDefinition, raw: RawAnswers): SubmissionResult {
  const errors: Record<string, string> = {};
  const known = new Set(def.questions.map((q) => q.ref));
  for (const ref of Object.keys(raw)) {
    if (!known.has(ref)) return { ok: false, errors: { _: "Malformed submission." } };
  }

  const visible = visibleRefs(def, raw);
  const answers: NormalizedAnswer[] = [];
  let overall: number | null = null;

  for (const q of def.questions) {
    if (!visible.has(q.ref)) continue;
    const value = raw[q.ref];
    if (isEmpty(value)) {
      if (q.required) errors[q.ref] = REQUIRED_MSG;
      continue;
    }
    const parsed = parseAnswer(q, value);
    if (!parsed.ok) {
      errors[q.ref] = parsed.message;
      continue;
    }
    answers.push({ questionRef: q.ref, ...parsed.answer });
    if (q.isPrimaryRating && RATING_TYPES.includes(q.type) && parsed.answer.valueNumber !== null) {
      overall = normalizeRating(q, parsed.answer.valueNumber);
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    answers,
    overallRating: overall,
    sentiment: overall === null ? null : sentimentOf(overall),
  };
}

export function isChoiceType(t: string): boolean {
  return CHOICE_TYPES.includes(t as never);
}
