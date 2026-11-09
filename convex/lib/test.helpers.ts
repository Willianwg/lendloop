// Test-only helpers shared by convex/*.test.ts. Not imported by production code.
import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "../test.setup";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { LoanStatus } from "./constants";

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

/** Awaits `p`, expecting it to throw a ConvexError, and returns the error's `{ code, message }`. */
export async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return e.data as { code: string; message: string };
    throw e;
  }
  throw new Error("expected the call to fail");
}

/** Inserts an active tool owned by `ownerId` and returns its id. */
export async function insertTool(
  t: TestConvex,
  ownerId: Id<"users">,
  fields: Partial<Omit<Doc<"tools">, "_id" | "_creationTime" | "ownerId">> = {},
): Promise<Id<"tools">> {
  return t.run((ctx) =>
    ctx.db.insert("tools", {
      ownerId,
      name: "Drill",
      category: "power_tools",
      condition: "good",
      description: "Cordless, two batteries",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...fields,
    }),
  );
}

/** Inserts a loan row directly (no events) and returns its id. The lender is the tool owner. */
export async function insertLoan(
  t: TestConvex,
  a: { toolId: Id<"tools">; borrowerId: Id<"users">; startDate: string; endDate: string; status: LoanStatus },
): Promise<Id<"loans">> {
  return t.run(async (ctx) => {
    const tool = await ctx.db.get(a.toolId);
    if (!tool) throw new Error("insertLoan: unknown tool");
    return ctx.db.insert("loans", { ...a, lenderId: tool.ownerId, createdAt: Date.now(), updatedAt: Date.now() });
  });
}
