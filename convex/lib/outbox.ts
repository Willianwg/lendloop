// Transactional outbox for Convex -> n8n loan events.
//
// The mutation that changes a loan calls `enqueueLoanEvent` in the same transaction: the
// delivery row and the scheduled send commit together with the state change, or not at all.
// The payload is not stored; `delivery.buildPayload` assembles it from current data at send time.
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { EventType } from "./constants";

export async function enqueueLoanEvent(
  ctx: MutationCtx,
  a: { loanId: Id<"loans">; type: EventType; recipientId: Id<"users">; actorId?: Id<"users"> },
): Promise<void> {
  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    eventId: crypto.randomUUID(), // n8n de-duplicates on this id
    loanId: a.loanId,
    type: a.type,
    recipientId: a.recipientId,
    actorId: a.actorId,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.delivery.send, { deliveryId });
}
