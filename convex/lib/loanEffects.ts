// Side effects on loans caused by something other than a loan transition.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { enqueueLoanEvent } from "./outbox";

/**
 * Cancels every pending request on a tool that is being removed (by its owner or an admin),
 * and tells each borrower. The system is the actor, so `actorId` is unset.
 */
export async function cancelPendingForTool(ctx: MutationCtx, toolId: Id<"tools">): Promise<void> {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
    .collect();
  const now = Date.now();
  for (const loan of pending) {
    await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: now, updatedAt: now });
    await enqueueLoanEvent(ctx, { loanId: loan._id, type: "loan.cancelled", recipientId: loan.borrowerId });
  }
}
