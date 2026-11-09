// Write-backs and reads for the n8n workflows (spec §8). The HTTP routes in http.ts verify the
// signature and the body shape, then call these internal functions, which hold the idempotency
// rules. None of them is callable from the app.
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { daysInclusive } from "./lib/dates";

/** A claim older than this is treated as a crashed run, and the event may be processed again. */
export const CLAIM_LEASE_MS = 5 * 60_000;
const DETAIL_MAX = 200;

const vResultStatus = v.union(v.literal("sent"), v.literal("failed"));

/**
 * n8n's de-duplication step: called before sending an email for a loan event. Returns
 * `proceed: true` to exactly one caller at a time, and never after the email went out.
 */
export const claimNotification = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const delivery = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (!delivery) return { found: false as const };
    const now = Date.now();
    if (delivery.notifyStatus === "sent") return { found: true as const, proceed: false };
    if (delivery.claimedAt !== undefined && now - delivery.claimedAt < CLAIM_LEASE_MS) {
      return { found: true as const, proceed: false };
    }
    await ctx.db.patch(delivery._id, { claimedAt: now });
    return { found: true as const, proceed: true };
  },
});

/**
 * Records whether the email for a loan event went out. Idempotent by eventId: repeating a
 * status records nothing, and `failed` never overwrites `sent`; `sent` may upgrade `failed`.
 */
export const recordNotificationResult = internalMutation({
  args: { eventId: v.string(), status: vResultStatus, executionId: v.string() },
  handler: async (ctx, { eventId, status, executionId }) => {
    const delivery = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (!delivery) return { found: false as const };
    if (delivery.notifyStatus === status || delivery.notifyStatus === "sent") {
      return { found: true as const, recorded: false };
    }
    const now = Date.now();
    await ctx.db.patch(delivery._id, { notifyStatus: status, processedAt: now });
    const loan = await ctx.db.get(delivery.loanId);
    const party = loan && delivery.recipientId === loan.lenderId ? "lender" : "borrower";
    await ctx.db.insert("automationEvents", {
      loanId: delivery.loanId,
      kind: status === "sent" ? "notification_sent" : "notification_failed",
      detail: status === "sent" ? `${party === "lender" ? "Lender" : "Borrower"} notified` : `Could not notify the ${party}`,
      externalId: executionId,
      at: now,
    });
    return { found: true as const, recorded: true };
  },
});

/**
 * Approved loans past their end date that have no `sent` reminder for `today` yet. A `failed`
 * reminder is listed again so the next run retries it. `return_claimed` loans are excluded.
 */
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", today))
      .collect();
    const due = [];
    for (const loan of loans) {
      const reminderKey = `${loan._id}:${today}`;
      const reminder = await ctx.db
        .query("reminders")
        .withIndex("by_key", (q) => q.eq("reminderKey", reminderKey))
        .unique();
      if (reminder?.status === "sent") continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      const tool = await ctx.db.get(loan.toolId);
      if (!borrower || !tool) continue; // never happens: rows are not hard-deleted
      due.push({
        loanId: loan._id,
        reminderKey,
        borrower: { email: borrower.email, name: borrower.name },
        tool: { name: tool.name },
        endDate: loan.endDate,
        daysOverdue: daysInclusive(loan.endDate, today) - 1,
      });
    }
    return due;
  },
});

/**
 * Upserts a reminder by its key (`${loanId}:${YYYY-MM-DD}`), so at most one reminder per loan per
 * day is recorded. Same rules as notification results: `sent` is final, `failed` can be upgraded.
 * The HTTP route already checked that the key matches the loan id and a real date.
 */
export const recordReminder = internalMutation({
  args: { reminderKey: v.string(), loanId: v.string(), status: vResultStatus, executionId: v.string() },
  handler: async (ctx, { reminderKey, loanId: rawLoanId, status, executionId }) => {
    const loanId = ctx.db.normalizeId("loans", rawLoanId);
    if (!loanId || !(await ctx.db.get(loanId))) return { found: false as const };
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_key", (q) => q.eq("reminderKey", reminderKey))
      .unique();
    if (existing && (existing.status === status || existing.status === "sent")) {
      return { found: true as const, recorded: false };
    }
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { status, n8nExecutionId: executionId, recordedAt: now });
    } else {
      await ctx.db.insert("reminders", { reminderKey, loanId, status, n8nExecutionId: executionId, recordedAt: now });
    }
    await ctx.db.insert("automationEvents", {
      loanId,
      kind: status === "sent" ? "reminder_sent" : "reminder_failed",
      detail: status === "sent" ? "Reminder sent" : "Reminder could not be sent",
      externalId: executionId,
      at: now,
    });
    return { found: true as const, recorded: true };
  },
});

/** Error text from n8n can quote an SMTP reply with the recipient's address; keep it out. */
function scrubEmails(text: string): string {
  return text.replace(/[^\s@<>"'()[\],;:]+@[^\s@<>"'()[\],;:]+\.[^\s@<>"'()[\],;:]+/g, "[email]");
}

/** Records a failed n8n execution (from the error workflow) once per execution id. */
export const recordWorkflowError = internalMutation({
  args: { workflowName: v.string(), nodeName: v.optional(v.string()), executionId: v.string(), message: v.string() },
  handler: async (ctx, { workflowName, nodeName, executionId, message }) => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_externalId", (q) => q.eq("externalId", executionId))
      .filter((q) => q.eq(q.field("kind"), "workflow_error"))
      .first();
    if (existing) return { recorded: false };
    const full = scrubEmails(`${workflowName}${nodeName ? " › " + nodeName : ""}: ${message}`);
    await ctx.db.insert("automationEvents", {
      kind: "workflow_error",
      detail: [...full].slice(0, DETAIL_MAX).join(""), // characters, not UTF-16 units
      externalId: executionId,
      at: Date.now(),
    });
    return { recorded: true };
  },
});

/** The admin "automation health" panel: what failed and needs a human. Latest 50 of each. */
export const adminHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const failed = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(50);
    const errors = await ctx.db
      .query("automationEvents")
      .withIndex("by_kind", (q) => q.eq("kind", "workflow_error"))
      .order("desc")
      .take(50);
    return {
      failedDeliveries: failed.map((d) => ({
        eventId: d.eventId,
        loanId: d.loanId,
        type: d.type,
        attempts: d.attempts,
        lastError: d.lastError ?? null,
        at: d.createdAt,
      })),
      workflowErrors: errors.map((e) => ({ detail: e.detail, at: e.at })),
    };
  },
});
