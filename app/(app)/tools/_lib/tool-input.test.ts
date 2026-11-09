import { describe, expect, it } from "vitest";
import { charCount, firstName, validateToolText } from "./tool-input";

describe("charCount", () => {
  it("trims and counts characters, not UTF-16 units", () => {
    expect(charCount("  João  ")).toBe(4);
    expect(charCount("🔨🪚")).toBe(2);
    expect(charCount("   ")).toBe(0);
  });
});

describe("validateToolText", () => {
  it("accepts the limits exactly", () => {
    expect(validateToolText({ name: "a".repeat(80), description: "é".repeat(280) })).toEqual({});
  });

  it("requires both fields after trimming", () => {
    expect(validateToolText({ name: "  ", description: "\n" })).toEqual({
      name: "Give the tool a name.",
      description: "Add a short description.",
    });
  });

  it("rejects one character over each limit", () => {
    expect(validateToolText({ name: "a".repeat(81), description: "b".repeat(281) })).toEqual({
      name: "Keep the name to 80 characters or fewer.",
      description: "Keep the description to 280 characters or fewer.",
    });
  });

  it("counts surrounding spaces out, like the server", () => {
    expect(validateToolText({ name: ` ${"a".repeat(80)} `, description: "ok" })).toEqual({});
  });
});

describe("firstName", () => {
  it("keeps the first word", () => {
    expect(firstName("João  Pereira")).toBe("João");
    expect(firstName("Ana")).toBe("Ana");
    expect(firstName("  ")).toBe("A neighbor");
  });
});
