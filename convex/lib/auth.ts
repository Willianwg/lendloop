// Every public Convex function resolves the viewer through one of these helpers.
// Authorization decisions use the database row, never ids or roles sent by the client.
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { fail } from "./errors";

export async function getViewer(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const viewer = await getViewer(ctx);
  if (!viewer) fail("UNAUTHENTICATED", "Sign in to continue.");
  return viewer;
}

export async function requireAdmin(ctx: QueryCtx): Promise<Doc<"users">> {
  const viewer = await requireUser(ctx);
  if (viewer.role !== "admin") fail("FORBIDDEN", "Admins only.");
  return viewer;
}
