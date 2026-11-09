// Loan dates are UTC calendar dates, "YYYY-MM-DD". Because the format is fixed-width,
// plain string comparison orders them correctly, so ranges are compared as strings.

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's UTC calendar date. */
export function todayUtc(now: number = Date.now()): string {
  return fromUtcMs(now);
}

export function addDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** True for a real calendar date in `YYYY-MM-DD` form ("2026-02-30" is rejected). */
export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const ms = toUtcMs(s);
  // Date.parse rolls invalid days over (or returns NaN); a round trip catches both.
  return !Number.isNaN(ms) && fromUtcMs(ms) === s;
}

/** Number of calendar days from `start` to `end`, counting both. */
export function daysInclusive(start: string, end: string): number {
  return Math.round((toUtcMs(end) - toUtcMs(start)) / DAY_MS) + 1;
}

/** Inclusive overlap: ranges that share a single day overlap. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
