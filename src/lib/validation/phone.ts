/**
 * Phone numbers for customer follow-up. Shared by the public form (instant feedback) and the server
 * (the authority). Accepts:
 *   - international: +<country code><number>, 9–15 digits in total (E.164), e.g. +251 911 234567
 *   - local:         0<9 digits>, e.g. 0911 234 567 (Ethiopian national format)
 * Spaces, dashes, dots and parentheses are allowed as separators and removed. Returns the normalized
 * number, or null when it is not a plausible phone number.
 */
const SEPARATORS = /[\s().-]/g;
const INTERNATIONAL = /^\+[1-9]\d{8,14}$/;
const LOCAL = /^0[1-9]\d{8}$/;

export const PHONE_MESSAGE = "Enter a valid phone number, for example 0911 234 567 or +251 911 234 567.";

export function normalizePhone(input: string): string | null {
  const value = input.trim();
  if (value.length > 30 || !/^\+?[\d\s().-]+$/.test(value)) return null;
  const compact = value.replace(SEPARATORS, "");
  if (!INTERNATIONAL.test(compact) && !LOCAL.test(compact)) return null;
  if (new Set(compact.replace("+", "")).size < 4) return null; // 0000000000, 0911111111…
  return compact;
}
