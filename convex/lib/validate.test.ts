import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { cleanText } from "./validate";

describe("cleanText", () => {
  test("returns the trimmed value", () => {
    expect(cleanText("  Cordless drill  ", "name", 1, 80)).toBe("Cordless drill");
  });

  test("rejects whitespace-only input", () => {
    expect(() => cleanText("   \n\t ", "name", 1, 80)).toThrow(ConvexError);
  });

  test("accepts exactly the maximum length and rejects one more", () => {
    expect(cleanText("a".repeat(80), "name", 1, 80)).toHaveLength(80);
    try {
      cleanText("a".repeat(81), "name", 1, 80);
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(ConvexError);
      expect((e as ConvexError<{ code: string; message: string }>).data).toEqual({
        code: "INVALID",
        message: "name must be 1–80 characters",
      });
    }
  });

  test("counts characters, not UTF-16 code units", () => {
    // 80 emoji are 160 UTF-16 code units but 80 characters.
    expect(cleanText("🔨".repeat(80), "name", 1, 80)).toHaveLength(160);
  });
});
