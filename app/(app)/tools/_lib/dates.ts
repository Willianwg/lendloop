// Date helpers for the request sheet and tool cards. They work in the viewer's local calendar:
// the person picks "today" as they see it, and the server tolerates the UTC offset
// (it accepts a start date of yesterday in UTC, Review Focus 1).
import { addDays, differenceInCalendarDays, format, isValid, parse, startOfDay } from "date-fns";
import type { Matcher } from "react-day-picker";
import { MAX_LOAN_DAYS } from "@/convex/lib/constants";

export { MAX_LOAN_DAYS };

/** A local calendar date as `YYYY-MM-DD` (never via toISOString, which would shift it to UTC). */
export function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** `YYYY-MM-DD` read as a local calendar date, or null when it isn't a real date. */
export function fromIsoDate(value: string): Date | null {
  const date = parse(value, "yyyy-MM-dd", new Date(0));
  return isValid(date) && toIsoDate(date) === value ? date : null;
}

/** "2026-11-20" → "Nov 20" (adds the year when it isn't `now`'s year). */
export function formatIsoDate(value: string, now: Date = new Date()): string {
  const date = fromIsoDate(value);
  if (!date) return value;
  return format(date, date.getFullYear() === now.getFullYear() ? "MMM d" : "MMM d, yyyy");
}

/** Calendar days from `from` to `to`, counting both. */
export function daysInclusive(from: Date, to: Date): number {
  return differenceInCalendarDays(to, from) + 1;
}

export type DateSelection = { from?: Date; to?: Date } | undefined;

/**
 * Days the calendar must not offer. Always: anything before local today. While only the
 * start is picked: anything that would make the loan longer than MAX_LOAN_DAYS, on either
 * side of the start (picking an earlier day makes it the new start).
 */
export function disabledDays(today: Date, selection: DateSelection): Matcher[] {
  const floor = startOfDay(today);
  const from = selection?.from;
  if (!from || selection?.to) return [{ before: floor }];
  const earliest = addDays(from, -(MAX_LOAN_DAYS - 1));
  return [{ before: earliest > floor ? earliest : floor }, { after: addDays(from, MAX_LOAN_DAYS - 1) }];
}

export type LoanDates = { startDate: string; endDate: string; days: number };

/**
 * The dates to send for a selection, or a reason it can't be sent. A start without an end
 * is a one-day loan. Mirrors the server's rules, using local today as the floor.
 */
export function loanDates(selection: DateSelection, today: Date): LoanDates | { error: string } {
  const from = selection?.from;
  if (!from) return { error: "Pick the day you'd pick it up." };
  const to = selection?.to ?? from;
  if (startOfDay(from) < startOfDay(today)) return { error: "The start date can't be in the past." };
  if (to < from) return { error: "The end date must be on or after the start date." };
  const days = daysInclusive(from, to);
  if (days > MAX_LOAN_DAYS) return { error: `A loan can last at most ${MAX_LOAN_DAYS} days.` };
  return { startDate: toIsoDate(from), endDate: toIsoDate(to), days };
}
