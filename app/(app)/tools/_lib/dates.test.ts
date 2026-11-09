import { describe, expect, it } from "vitest";
import { daysInclusive, disabledDays, formatIsoDate, fromIsoDate, loanDates, MAX_LOAN_DAYS, toIsoDate } from "./dates";

// Local calendar dates (month is 0-based): the helpers never go through UTC.
const day = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h);

describe("toIsoDate / fromIsoDate", () => {
  it("formats the local calendar date, even late in the evening", () => {
    // 22:00 local is already the next day in UTC for anyone west of UTC (Review Focus 1).
    expect(toIsoDate(day(2026, 11, 9, 22))).toBe("2026-11-09");
    expect(toIsoDate(day(2026, 1, 5, 0))).toBe("2026-01-05");
  });

  it("round-trips and rejects impossible dates", () => {
    expect(toIsoDate(fromIsoDate("2026-12-31")!)).toBe("2026-12-31");
    expect(fromIsoDate("2026-02-30")).toBeNull();
    expect(fromIsoDate("20261231")).toBeNull();
  });
});

describe("formatIsoDate", () => {
  it("omits the year when it is the current one", () => {
    expect(formatIsoDate("2026-11-20", day(2026, 11, 9))).toBe("Nov 20");
    expect(formatIsoDate("2027-01-03", day(2026, 11, 9))).toBe("Jan 3, 2027");
  });
  it("shows unparseable input as it is", () => {
    expect(formatIsoDate("soon", day(2026, 11, 9))).toBe("soon");
  });
});

describe("daysInclusive", () => {
  it("counts both ends, across a DST change", () => {
    expect(daysInclusive(day(2026, 11, 9), day(2026, 11, 9))).toBe(1);
    expect(daysInclusive(day(2026, 3, 1), day(2026, 3, 31))).toBe(31);
  });
});

describe("disabledDays", () => {
  const today = day(2026, 11, 9, 15);

  it("blocks only past days when nothing or a full range is picked", () => {
    expect(disabledDays(today, undefined)).toEqual([{ before: day(2026, 11, 9) }]);
    expect(disabledDays(today, { from: day(2026, 11, 10), to: day(2026, 11, 12) })).toEqual([
      { before: day(2026, 11, 9) },
    ]);
  });

  it("caps the range at 30 days from the picked start", () => {
    const [before, after] = disabledDays(today, { from: day(2026, 11, 10) });
    expect(before).toEqual({ before: day(2026, 11, 9) });
    expect(after).toEqual({ after: day(2026, 12, 9) });
    expect(daysInclusive(day(2026, 11, 10), day(2026, 12, 9))).toBe(MAX_LOAN_DAYS);
  });

  it("caps an earlier pick too, when the start is far ahead", () => {
    const [before] = disabledDays(today, { from: day(2027, 1, 30) });
    expect(before).toEqual({ before: day(2027, 1, 1) });
    expect(daysInclusive(day(2027, 1, 1), day(2027, 1, 30))).toBe(MAX_LOAN_DAYS);
  });
});

describe("loanDates", () => {
  const today = day(2026, 11, 9, 22);

  it("needs a start", () => {
    expect(loanDates(undefined, today)).toEqual({ error: "Pick the day you'd pick it up." });
  });

  it("treats a lone start as a one-day loan, starting today", () => {
    expect(loanDates({ from: day(2026, 11, 9) }, today)).toEqual({
      startDate: "2026-11-09",
      endDate: "2026-11-09",
      days: 1,
    });
  });

  it("accepts exactly 30 days and rejects 31", () => {
    expect(loanDates({ from: day(2026, 11, 10), to: day(2026, 12, 9) }, today)).toEqual({
      startDate: "2026-11-10",
      endDate: "2026-12-09",
      days: 30,
    });
    expect(loanDates({ from: day(2026, 11, 10), to: day(2026, 12, 10) }, today)).toEqual({
      error: "A loan can last at most 30 days.",
    });
  });

  it("rejects a start before local today and an end before the start", () => {
    expect(loanDates({ from: day(2026, 11, 8) }, today)).toEqual({ error: "The start date can't be in the past." });
    expect(loanDates({ from: day(2026, 11, 12), to: day(2026, 11, 11) }, today)).toEqual({
      error: "The end date must be on or after the start date.",
    });
  });
});
