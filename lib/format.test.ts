import { describe, expect, test } from "vitest";
import { formatCategory, formatCondition } from "./format";

describe("formatCategory", () => {
  test("maps every category literal to its label", () => {
    expect(formatCategory("power_tools")).toBe("Power tools");
    expect(formatCategory("hand_tools")).toBe("Hand tools");
    expect(formatCategory("garden")).toBe("Garden");
    expect(formatCategory("kitchen")).toBe("Kitchen");
    expect(formatCategory("camping")).toBe("Camping");
    expect(formatCategory("cleaning")).toBe("Cleaning");
    expect(formatCategory("other")).toBe("Other");
  });

  test("falls back to the raw value for an unknown category", () => {
    expect(formatCategory("boats")).toBe("boats");
  });
});

describe("formatCondition", () => {
  test("maps conditions to labels", () => {
    expect(formatCondition("new")).toBe("New");
    expect(formatCondition("worn")).toBe("Worn");
  });
});
