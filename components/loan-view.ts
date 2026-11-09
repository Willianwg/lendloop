// Pure helpers behind the loan pages (Requests, Incoming, loan detail, admin Loans tab).
// No React here, so they are unit-tested in loan-view.test.ts.
import { formatDistance } from "date-fns";
import type { EventType } from "@/convex/lib/constants";
import type { LoanAction } from "@/convex/lib/loans";

const DAY_MS = 86_400_000;

/** Today's date in UTC as YYYY-MM-DD: the calendar the server uses for loan dates. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function utcMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `endDate` to `today` (both YYYY-MM-DD). 0 when the end date is today or later. */
export function overdueDays(endDate: string, today: string): number {
  return Math.max(0, Math.round((utcMs(today) - utcMs(endDate)) / DAY_MS));
}

/** How many calendar days a loan covers, both ends included. */
export function loanLength(startDate: string, endDate: string): number {
  return Math.round((utcMs(endDate) - utcMs(startDate)) / DAY_MS) + 1;
}

/** The `overdueDays` value for `<StatusBadge>`: only for rows the server flagged as overdue. */
export function badgeOverdueDays(row: { overdue: boolean; endDate: string }, today: string): number {
  return row.overdue ? overdueDays(row.endDate, today) : 0;
}

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayYearFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const weekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/** "Nov 12", or "Jan 3, 2027" when the date is not in `today`'s year. Loan dates are UTC calendar dates. */
export function formatDay(isoDate: string, today: string): string {
  const date = new Date(utcMs(isoDate));
  return isoDate.slice(0, 4) === today.slice(0, 4) ? dayFormat.format(date) : dayYearFormat.format(date);
}

/** "Thu" for a YYYY-MM-DD date. */
export function formatWeekday(isoDate: string): string {
  return weekdayFormat.format(new Date(utcMs(isoDate)));
}

/** "Nov 12 – Nov 15", or "Nov 12" for a one-day loan. */
export function formatRange(startDate: string, endDate: string, today: string): string {
  const start = formatDay(startDate, today);
  return startDate === endDate ? start : `${start} – ${formatDay(endDate, today)}`;
}

/** "4 days" / "1 day". */
export function pluralDays(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * "Reminder sent 2 days ago": the server's short detail plus a relative time. A time slightly
 * ahead of `now` (clock skew, or `now` rounded to the minute) reads as "less than a minute ago".
 */
export function activityText(detail: string, at: number, now: number): string {
  return `${detail} ${formatDistance(Math.min(at, now), now, { addSuffix: true })}`;
}

/** Splits a list into the loans the viewer can act on now and the rest, keeping the order. */
export function groupLoans<T extends { allowedActions: readonly string[] }>(rows: readonly T[]) {
  const needsAction: T[] = [];
  const other: T[] = [];
  for (const row of rows) (row.allowedActions.length > 0 ? needsAction : other).push(row);
  return { needsAction, other };
}

export type ActionMeta = {
  label: string;
  /** Toast shown after the server accepts the action. */
  done: string;
  variant: "default" | "outline" | "destructive";
  /** Present when the action needs an AlertDialog first. `{name}` is the other party's name. */
  confirm?: { title: string; body: string; cancel: string };
};

/** Button labels are fixed by the plan (Task 12). */
export const ACTIONS: Record<LoanAction, ActionMeta> = {
  approve: { label: "Approve", done: "Request approved", variant: "default" },
  decline: {
    label: "Decline",
    done: "Request declined",
    variant: "destructive",
    confirm: {
      title: "Decline this request?",
      body: "{name} gets an email saying you declined. This can't be undone.",
      cancel: "Keep request",
    },
  },
  cancel: {
    label: "Cancel request",
    done: "Request cancelled",
    variant: "destructive",
    confirm: {
      title: "Cancel this request?",
      body: "{name} gets an email saying you no longer need the tool. This can't be undone.",
      cancel: "Keep request",
    },
  },
  revoke: {
    label: "Cancel loan",
    done: "Loan cancelled",
    variant: "destructive",
    confirm: {
      title: "Cancel this loan?",
      body: "It hasn't started yet. {name} gets an email saying the loan is off. This can't be undone.",
      cancel: "Keep loan",
    },
  },
  claim_return: { label: "I returned it", done: "Return reported to the lender", variant: "default" },
  confirm_return: { label: "Confirm return", done: "Return confirmed", variant: "default" },
  dispute_return: {
    label: "Not returned yet",
    done: "Loan marked as not returned",
    variant: "destructive",
    confirm: {
      title: "The tool isn't back yet?",
      body: "The loan stays open and {name} gets an email asking for the tool. If it's past the end date, daily reminders start again.",
      cancel: "Go back",
    },
  },
  mark_returned: {
    label: "Mark as returned",
    done: "Loan closed as returned",
    variant: "outline",
    // Irreversible: it closes the loan, stops reminders and emails the borrower.
    confirm: {
      title: "Is the tool back with you?",
      body: "This closes the loan and tells {name} the return is confirmed. It can't be undone.",
      cancel: "Not yet",
    },
  },
};

/** Order buttons by weight: the main action first, then the quieter ones. */
export const ACTION_ORDER: readonly LoanAction[] = [
  "approve",
  "confirm_return",
  "claim_return",
  "mark_returned",
  "dispute_return",
  "decline",
  "revoke",
  "cancel",
];

export function sortActions(actions: readonly LoanAction[]): LoanAction[] {
  return [...actions].sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b));
}

/** Which side of the loan the viewer is on, as computed by the server (`LoanRow.viewerRole`). */
export type ViewerRole = "borrower" | "lender" | null;

const EVENT_LABELS: Record<EventType, string> = {
  "loan.requested": "Request",
  "loan.approved": "Approval",
  "loan.declined": "Decline",
  "loan.cancelled": "Cancellation",
  "loan.return_claimed": "Return claim",
  "loan.returned": "Return",
  "loan.return_disputed": "Return dispute",
};

/** "loan.return_claimed" → "Return claim" (admin automation panel). Unknown types are shown as they are. */
export function eventLabel(type: string): string {
  return EVENT_LABELS[type as EventType] ?? type;
}
