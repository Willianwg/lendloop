import { describe, expect, test } from "vitest";
import {
  ACTIONS,
  activityText,
  badgeOverdueDays,
  eventLabel,
  formatDay,
  formatRange,
  groupLoans,
  loanLength,
  overdueDays,
  pluralDays,
  sortActions,
  todayUtc,
} from "./loan-view";

describe("dates", () => {
  test("todayUtc uses the UTC calendar, not the local one", () => {
    // 22:30 in UTC-3 on Nov 9 is already Nov 10 in UTC.
    expect(todayUtc(new Date("2026-11-10T01:30:00Z"))).toBe("2026-11-10");
  });

  test("overdueDays counts whole days past the end date", () => {
    expect(overdueDays("2026-11-05", "2026-11-09")).toBe(4);
    expect(overdueDays("2026-11-08", "2026-11-09")).toBe(1);
    expect(overdueDays("2026-11-09", "2026-11-09")).toBe(0);
    expect(overdueDays("2026-11-12", "2026-11-09")).toBe(0);
    expect(overdueDays("2026-12-31", "2027-01-02")).toBe(2);
  });

  test("badgeOverdueDays is 0 unless the server flagged the row", () => {
    expect(badgeOverdueDays({ overdue: true, endDate: "2026-11-06" }, "2026-11-09")).toBe(3);
    expect(badgeOverdueDays({ overdue: false, endDate: "2026-11-06" }, "2026-11-09")).toBe(0);
  });

  test("loanLength includes both ends", () => {
    expect(loanLength("2026-11-12", "2026-11-12")).toBe(1);
    expect(loanLength("2026-11-12", "2026-11-15")).toBe(4);
    expect(loanLength("2026-11-01", "2026-11-30")).toBe(30);
  });

  test("formatDay and formatRange read dates as UTC calendar days", () => {
    expect(formatDay("2026-11-12", "2026-11-09")).toBe("Nov 12");
    expect(formatDay("2027-01-03", "2026-11-09")).toBe("Jan 3, 2027");
    expect(formatRange("2026-11-12", "2026-11-15", "2026-11-09")).toBe("Nov 12 – Nov 15");
    expect(formatRange("2026-11-12", "2026-11-12", "2026-11-09")).toBe("Nov 12");
  });

  test("pluralDays", () => {
    expect(pluralDays(1)).toBe("1 day");
    expect(pluralDays(4)).toBe("4 days");
  });
});

test("activityText appends a relative time", () => {
  const now = Date.UTC(2026, 10, 9, 12);
  expect(activityText("Reminder sent", now - 2 * 86_400_000, now)).toBe("Reminder sent 2 days ago");
  expect(activityText("Lender notified", now - 5 * 60_000, now)).toBe("Lender notified 5 minutes ago");
  expect(activityText("Lender notified", now + 20_000, now)).toBe("Lender notified less than a minute ago");
});

test("groupLoans splits by allowedActions and keeps the order", () => {
  const rows = [
    { id: 1, allowedActions: [] },
    { id: 2, allowedActions: ["approve"] },
    { id: 3, allowedActions: ["cancel"] },
    { id: 4, allowedActions: [] },
  ];
  const { needsAction, other } = groupLoans(rows);
  expect(needsAction.map((r) => r.id)).toEqual([2, 3]);
  expect(other.map((r) => r.id)).toEqual([1, 4]);
});

test("action labels match the plan", () => {
  expect(Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.label]))).toEqual({
    approve: "Approve",
    decline: "Decline",
    cancel: "Cancel request",
    claim_return: "I returned it",
    confirm_return: "Confirm return",
    dispute_return: "Not returned yet",
    mark_returned: "Mark as returned",
  });
  // Destructive actions go through an AlertDialog.
  for (const meta of Object.values(ACTIONS)) {
    expect(meta.variant === "destructive").toBe(meta.confirm !== undefined);
  }
});

test("sortActions puts the main action first", () => {
  expect(sortActions(["decline", "approve"])).toEqual(["approve", "decline"]);
  expect(sortActions(["dispute_return", "confirm_return"])).toEqual(["confirm_return", "dispute_return"]);
});


test("eventLabel", () => {
  expect(eventLabel("loan.return_claimed")).toBe("Return claim");
  expect(eventLabel("loan.other")).toBe("loan.other");
});
