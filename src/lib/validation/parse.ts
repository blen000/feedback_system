import type { ZodType } from "zod";
import { invalid } from "@/lib/errors";

/** Server-side parse; throws a VALIDATION AppError carrying per-field messages. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw invalid("Please correct the highlighted fields.", fieldErrors);
}
