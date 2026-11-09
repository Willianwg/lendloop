import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { errorCode, errorMessage } from "./errors";

describe("errorMessage", () => {
  test("reads the message of an app ConvexError", () => {
    const e = new ConvexError({ code: "INVALID", message: "Clerk session token is missing the email claim." });
    expect(errorMessage(e)).toBe("Clerk session token is missing the email claim.");
  });

  test("uses a plain string ConvexError payload", () => {
    expect(errorMessage(new ConvexError("Tool not found."))).toBe("Tool not found.");
  });

  test("hides internal server errors behind a generic message", () => {
    expect(errorMessage(new Error("[CONVEX M(users:ensureCurrent)] Server Error"))).toBe(
      "Something went wrong. Try again in a moment.",
    );
    expect(errorMessage(undefined)).toBe("Something went wrong. Try again in a moment.");
  });
});

describe("errorCode", () => {
  test("reads the code of an app ConvexError", () => {
    expect(errorCode(new ConvexError({ code: "CONFLICT", message: "x" }))).toBe("CONFLICT");
  });

  test("is null for anything else", () => {
    expect(errorCode(new Error("boom"))).toBeNull();
    expect(errorCode(new ConvexError("plain"))).toBeNull();
  });
});
