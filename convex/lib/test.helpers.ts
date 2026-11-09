// Test-only helpers shared by convex/*.test.ts. Not imported by production code.
import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";

export function setup() {
  return convexTest(schema, modules);
}

export type TestConvex = ReturnType<typeof setup>;

export const identity = (key: string, extra: Record<string, unknown> = {}) => ({
  subject: `user_${key}`,
  issuer: "https://test.clerk.accounts.dev",
  email: `${key}@example.test`,
  name: key[0].toUpperCase() + key.slice(1),
  ...extra,
});

/** Inserts a user row directly (bypassing ensureCurrent) and returns its id. */
export async function insertUser(
  t: TestConvex,
  key: string,
  role: "user" | "admin" = "user",
  trustedLender = false,
): Promise<Id<"users">> {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: `user_${key}`,
      name: key[0].toUpperCase() + key.slice(1),
      email: `${key}@example.test`,
      role,
      trustedLender,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}
