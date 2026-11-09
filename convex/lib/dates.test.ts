import { describe, expect, test } from "vitest";
import { addDays, daysInclusive, isIsoDate, rangesOverlap, todayUtc } from "./dates";

describe("dates", () => {
  test("todayUtc uses the UTC calendar date", () => {
    expect(todayUtc(Date.UTC(2026, 10, 9, 23, 59))).toBe("2026-11-09");
    expect(todayUtc(Date.UTC(2026, 10, 10, 0, 0))).toBe("2026-11-10");
  });

  test("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("isIsoDate accepts real calendar dates only", () => {
    expect(isIsoDate("2026-11-09")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-01")).toBe(false);
    expect(isIsoDate("2026-11-09T00:00:00Z")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  test("daysInclusive counts both ends", () => {
    expect(daysInclusive("2026-11-09", "2026-11-09")).toBe(1);
    expect(daysInclusive("2026-11-09", "2026-12-08")).toBe(30);
  });

  test("rangesOverlap is inclusive", () => {
    expect(rangesOverlap("2026-11-01", "2026-11-05", "2026-11-05", "2026-11-09")).toBe(true);
    expect(rangesOverlap("2026-11-05", "2026-11-09", "2026-11-01", "2026-11-05")).toBe(true);
    expect(rangesOverlap("2026-11-01", "2026-11-30", "2026-11-10", "2026-11-12")).toBe(true);
    expect(rangesOverlap("2026-11-01", "2026-11-04", "2026-11-05", "2026-11-09")).toBe(false);
  });
});
