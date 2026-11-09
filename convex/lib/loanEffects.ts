// Side effects on loans caused by something other than a loan transition.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Cancels every pending request on a tool that is being removed.
 * TODO(Task 6): notify each borrower with a `loan.cancelled` event.
 */
export async function cancelPendingForTool(ctx: MutationCtx, toolId: Id<"tools">): Promise<void> {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
    .collect();
  const now = Date.now();
  for (const loan of pending) {
    await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: now, updatedAt: now });
  }
}
