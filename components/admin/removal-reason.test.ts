import { expect, test } from "vitest";
import { reasonError, reasonLength } from "./removal-reason";

test("a removal reason is 3–200 characters after trimming", () => {
  expect(reasonError("  ab  ")).toBe("Write at least 3 characters.");
  expect(reasonError("Spam")).toBeNull();
  expect(reasonError("x".repeat(200))).toBeNull();
  expect(reasonError("x".repeat(201))).toBe("Keep it to 200 characters or fewer.");
});

test("length counts characters, not UTF-16 units, like the server", () => {
  expect(reasonLength(" 🔧🔧🔧 ")).toBe(3);
  expect(reasonError("🔧🔧🔧")).toBeNull();
});
