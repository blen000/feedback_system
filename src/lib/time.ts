/**
 * Reporting day boundaries. The bank operates in East Africa Time (UTC+3, no daylight saving),
 * so "today", date filters and daily buckets follow that clock, not the server's.
 */
export const REPORT_TZ_OFFSET_HOURS = 3;
const OFFSET = "+03:00";
const HOUR = 3600_000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDateString = (s: unknown): s is string =>
  typeof s === "string" && DATE.test(s) && !Number.isNaN(Date.parse(s));

export function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00${OFFSET}`);
}

/** Exclusive upper bound: the start of the following day. */
export function dayEndExclusive(date: string): Date {
  return new Date(dayStart(date).getTime() + 24 * HOUR);
}

/** yyyy-mm-dd of an instant on the reporting clock. */
export function dayKey(d: Date): string {
  return new Date(d.getTime() + REPORT_TZ_OFFSET_HOURS * HOUR).toISOString().slice(0, 10);
}

export function today(): string {
  return dayKey(new Date());
}

export function addDays(date: string, days: number): string {
  return dayKey(new Date(dayStart(date).getTime() + days * 24 * HOUR));
}

/** Inclusive list of yyyy-mm-dd between two dates (capped to avoid runaway ranges). */
export function eachDay(from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < cap; d = addDays(d, 1)) out.push(d);
  return out;
}
