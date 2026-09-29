import { z } from "zod";
import { isDateString } from "@/lib/time";

const uuid = z.string().uuid();
const date = z.string().refine(isDateString, "Use yyyy-mm-dd.");

/** Filters shared by the feedback list, exports and reports. All values arrive from the query string, so nothing is trusted. */
export const feedbackFilterSchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    from: date.optional(),
    to: date.optional(),
    districtId: uuid.optional(),
    branchId: uuid.optional(),
    departmentId: uuid.optional(),
    questionnaireId: uuid.optional(),
    sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]).optional(),
    minRating: z.coerce.number().min(1).max(5).optional(),
    maxRating: z.coerce.number().min(1).max(5).optional(),
    /** filter by an answer: question ref + option value (yes/no or a choice value) */
    questionRef: uuid.optional(),
    answer: z.string().max(100).optional(),
    followUp: z.enum(["1"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, {
    path: ["to"],
    message: "End date is before the start date.",
  });

export type FeedbackFilters = z.infer<typeof feedbackFilterSchema>;

/** Query-string → validated filters. Invalid or empty values are dropped rather than failing the page. */
export function parseFilters(raw: Record<string, string | string[] | undefined>): FeedbackFilters {
  const flat = Object.fromEntries(
    Object.entries(raw).flatMap(([k, v]) => {
      const s = Array.isArray(v) ? v[0] : v;
      return s === undefined || s === "" ? [] : [[k, s]];
    }),
  );
  const parsed = feedbackFilterSchema.safeParse(flat);
  if (parsed.success) return parsed.data;
  // keep whichever fields are individually valid
  const valid: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    const one = feedbackFilterSchema.safeParse({ [k]: v });
    if (one.success) valid[k] = v;
  }
  const retry = feedbackFilterSchema.safeParse(valid);
  return retry.success ? retry.data : feedbackFilterSchema.parse({});
}
