/**
 * Shapes shared by the builder, the preview, the public form and server-side validation.
 * A QuestionnaireDefinition is the immutable snapshot stored in QuestionnaireVersion.definition.
 */

export const QUESTION_TYPES = [
  "YES_NO",
  "STAR_RATING",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "SHORT_TEXT",
  "LONG_TEXT",
  "NUMBER",
  "NPS",
  "EMOJI_RATING",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  YES_NO: "Yes / No",
  STAR_RATING: "Star rating",
  SINGLE_CHOICE: "Single choice",
  MULTIPLE_CHOICE: "Multiple choice",
  SHORT_TEXT: "Short text",
  LONG_TEXT: "Long text",
  NUMBER: "Number",
  NPS: "NPS (0–10)",
  EMOJI_RATING: "Emoji rating",
};

export const RATING_TYPES: readonly QuestionType[] = ["STAR_RATING", "EMOJI_RATING", "NPS"];
export const CHOICE_TYPES: readonly QuestionType[] = ["SINGLE_CHOICE", "MULTIPLE_CHOICE"];

export const EMOJI_SCALE = ["😞", "😕", "😐", "🙂", "😍"] as const;

/** Languages the system is prepared for. Add a row to support another language. */
export const SUPPORTED_LOCALES = [
  { code: "en", name: "English" },
  { code: "am", name: "አማርኛ (Amharic)" },
] as const;
export const DEFAULT_LOCALE = "en";

/** locale code → text */
export type Localized = Record<string, string>;

export interface QuestionConfig {
  /** STAR_RATING: number of stars (3–10, default 5) */
  scale?: number;
  /** NUMBER bounds */
  min?: number;
  max?: number;
  /** NUMBER: whole numbers only */
  integer?: boolean;
  /** SHORT_TEXT / LONG_TEXT length limits */
  minLength?: number;
  maxLength?: number;
  /** MULTIPLE_CHOICE selection limits */
  minSelect?: number;
  maxSelect?: number;
}

export type VisibilityOperator = "equals" | "not_equals" | "in" | "gte" | "lte" | "answered";

export interface VisibilityRule {
  /** ref of an EARLIER question in the same questionnaire */
  questionRef: string;
  operator: VisibilityOperator;
  /** string for choices/yes-no, number for ratings/number, string[] for "in" */
  value?: string | number | string[];
}

export interface Visibility {
  match: "all" | "any";
  rules: VisibilityRule[];
}

export interface DefinitionOption {
  value: string;
  label: Localized;
}

export interface DefinitionQuestion {
  /** QuestionnaireQuestion.id — stable across versions; answers are keyed by this. */
  ref: string;
  type: QuestionType;
  text: Localized;
  description?: Localized;
  placeholder?: Localized;
  required: boolean;
  isPrimaryRating: boolean;
  config: QuestionConfig;
  options: DefinitionOption[];
  visibility: Visibility | null;
}

export interface QuestionnaireDefinition {
  questionnaireId: string;
  version: number;
  defaultLocale: string;
  locales: string[];
  collectContact: boolean;
  title: Localized;
  description: Localized;
  questions: DefinitionQuestion[];
}

/** Raw answer as sent by a browser: never trusted. */
export type RawAnswers = Record<string, unknown>;

export interface NormalizedAnswer {
  questionRef: string;
  questionType: QuestionType;
  valueText: string | null;
  valueNumber: number | null;
  valueOptions: string[];
}

/** Localized lookup with fallback to the default locale, then any available value. */
export function pick(text: Localized | undefined, locale: string, fallback = DEFAULT_LOCALE): string {
  if (!text) return "";
  return text[locale]?.trim() || text[fallback]?.trim() || Object.values(text).find((v) => v?.trim()) || "";
}
