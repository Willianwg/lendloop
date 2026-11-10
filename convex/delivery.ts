// Sends outbox rows (lib/outbox.ts) to the n8n loan-events webhook, with retries.
//
// Delivery is at-least-once: a request that times out after n8n already processed it is
// retried, and n8n de-duplicates through the claim endpoint (automation.ts).
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { BACKOFF_MS, type EventType, type LoanStatus } from "./lib/constants";
import { signRequest, SIGNATURE_HEADER } from "./lib/signature";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 200;

/** Only what the email needs. No ids other than the loan's, no other user's email. */
export type LoanEventPayload = {
  eventId: string;
  type: EventType;
  occurredAt: string;
  recipient: { email: string; name: string };
  tool: { name: string };
  loan: { id: string; startDate: string; endDate: string; status: LoanStatus };
  actor: { name: string } | null; // null = the system acted (auto-decline, listing removed)
};

/** Builds the payload from current data, or null when there is nothing (left) to send. */
export const buildPayload = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }): Promise<LoanEventPayload | null> => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || delivery.status !== "pending") return null;
    const loan = await ctx.db.get(delivery.loanId);
    const recipient = await ctx.db.get(delivery.recipientId);
    const tool = loan && (await ctx.db.get(loan.toolId));
    if (!loan || !recipient || !tool) return null; // rows are never hard-deleted; defensive only
    const actor = delivery.actorId ? await ctx.db.get(delivery.actorId) : null;
    return {
      eventId: delivery.eventId,
      type: delivery.type,
      occurredAt: new Date(delivery.createdAt).toISOString(),
      recipient: { email: recipient.email, name: recipient.name },
      tool: { name: tool.name },
      loan: { id: loan._id, startDate: loan.startDate, endDate: loan.endDate, status: loan.status },
      // System events (auto-decline, cancellation on tool removal) have no human actor. An
      // explicit null, not a sentinel name, so no user can name themselves into "the system".
      actor: actor ? { name: actor.name } : null,
    };
  },
});

async function post(url: string, secret: string, payload: LoanEventPayload): Promise<{ ok: boolean; error?: string }> {
  const body = JSON.stringify(payload);
  try {
    // The signature binds the path n8n sees (e.g. /webhook/lendloop-loan-events), not the host.
    const signature = await signRequest({ secret, method: "POST", path: new URL(url).pathname, body });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: signature },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // n8n answers only after the workflow ran, so 2xx means the recipient was notified (or it was a duplicate).
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    const error = e instanceof Error ? (e.name === "TimeoutError" ? "timeout" : e.message) : String(e);
    return { ok: false, error };
  }
}

export const send = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }): Promise<void> => {
    const payload = await ctx.runQuery(internal.delivery.buildPayload, { deliveryId });
    if (!payload) return; // already sent or failed (a duplicate scheduled run): nothing to do

    const url = process.env.N8N_LOAN_EVENTS_WEBHOOK_URL;
    const secret = process.env.CONVEX_TO_N8N_SECRET;
    const started = Date.now();
    const result = url && secret ? await post(url, secret, payload) : { ok: false, error: "not configured" };
    await ctx.runMutation(internal.delivery.recordAttempt, {
      deliveryId,
      ok: result.ok,
      error: result.error,
      durationMs: Date.now() - started,
    });
  },
});

/** Records one attempt's outcome and decides what happens next: done, retry later, or give up. */
export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    ok: v.boolean(),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, { deliveryId, ok, error, durationMs }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || delivery.status !== "pending") return;
    const now = Date.now();
    // Ids and outcome only: never emails, names or secrets.
    const log = (status: string, extra: Record<string, unknown> = {}) =>
      console.log(
        JSON.stringify({
          event: "delivery.attempt",
          deliveryId,
          eventId: delivery.eventId,
          loanId: delivery.loanId,
          type: delivery.type,
          status,
          durationMs,
          ...extra,
        }),
      );

    if (ok) {
      await ctx.db.patch(deliveryId, { status: "sent", nextAttemptAt: undefined });
      log("sent", { attempt: delivery.attempts + 1 });
      return;
    }

    // `attempts` counts failed attempts, so a delivery that succeeds after one failure shows 1.
    const attempts = delivery.attempts + 1;
    const lastError = (error ?? "unknown error").slice(0, MAX_ERROR_LENGTH);
    if (attempts <= BACKOFF_MS.length) {
      const delay = BACKOFF_MS[attempts - 1];
      await ctx.db.patch(deliveryId, { attempts, lastError, nextAttemptAt: now + delay });
      await ctx.scheduler.runAfter(delay, internal.delivery.send, { deliveryId });
      log("retry_scheduled", { attempt: attempts, error: lastError, retryInMs: delay });
      return;
    }

    await ctx.db.patch(deliveryId, { status: "failed", attempts, lastError, nextAttemptAt: undefined });
    await ctx.db.insert("automationEvents", {
      loanId: delivery.loanId,
      kind: "delivery_failed",
      detail: "Could not reach the automation service",
      at: now,
    });
    log("failed", { attempt: attempts, error: lastError });
  },
});

/** A pending delivery whose attempt was due longer ago than this is considered stuck. */
export const STUCK_AFTER_MS = 5 * 60_000;

/**
 * Safety net for the outbox, run by convex/crons.ts. A scheduled send runs at most once: if
 * the backend restarts mid-send, or `send` dies before `recordAttempt`, nothing would ever
 * retry that row. This re-schedules every `pending` delivery whose attempt is overdue.
 * A duplicate send is harmless: n8n's claim lease de-duplicates by eventId.
 */
export const sweepStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(200);
    let rescheduled = 0;
    for (const delivery of pending) {
      const due = delivery.nextAttemptAt ?? delivery.createdAt;
      if (now - due < STUCK_AFTER_MS) continue;
      await ctx.db.patch(delivery._id, { nextAttemptAt: now });
      await ctx.scheduler.runAfter(0, internal.delivery.send, { deliveryId: delivery._id });
      rescheduled++;
    }
    if (rescheduled > 0) console.log(JSON.stringify({ event: "delivery.sweep", rescheduled }));
    return { rescheduled };
  },
});
