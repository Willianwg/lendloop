import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";
import { CONTACT_WINDOW_DAYS, MAX_LOAN_DAYS, MAX_OPEN_REQUESTS, vLoanStatus, type EventType } from "./lib/constants";
import { addDays, daysInclusive, isIsoDate, rangesOverlap, todayUtc } from "./lib/dates";
import { fail } from "./lib/errors";
import { ACTIVE_STATUSES, activeLoansOfTool, allowedActions, checkTransition, isExpired, isOverdue, vLoanAction } from "./lib/loans";
import { enqueueLoanEvent } from "./lib/outbox";

/**
 * Asks to borrow a tool. Dates are UTC calendar dates; a start date of "yesterday (UTC)" is
 * accepted because for someone west of UTC it may still be today (Review Focus 1).
 */
export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const viewer = await requireUser(ctx);
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) fail("INVALID", "Dates must be valid YYYY-MM-DD dates.");
    if (startDate < addDays(todayUtc(), -1)) fail("INVALID", "The start date can't be in the past.");
    if (endDate < startDate) fail("INVALID", "The end date must be on or after the start date.");
    if (daysInclusive(startDate, endDate) > MAX_LOAN_DAYS) {
      fail("INVALID", `A loan can last at most ${MAX_LOAN_DAYS} days.`);
    }

    const tool = await ctx.db.get(toolId);
    if (!tool || tool.status !== "active") fail("NOT_FOUND", "This tool is no longer listed.");
    if (tool.ownerId === viewer._id) fail("FORBIDDEN", "You can't borrow your own tool.");

    // Don't accept a request the lender could never approve.
    const lentOut = await activeLoansOfTool(ctx, toolId);
    if (lentOut.some((loan) => rangesOverlap(loan.startDate, loan.endDate, startDate, endDate))) {
      fail("CONFLICT", "The tool is already lent out for some of these dates.");
    }

    const open = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .collect();
    if (open.filter((loan) => loan.status === "pending").length >= MAX_OPEN_REQUESTS) {
      fail("CONFLICT", `You have ${MAX_OPEN_REQUESTS} open requests. Wait for an answer or cancel one first.`);
    }

    // Mutations are serializable, so this check also stops a double tap (Review Focus 5).
    const myPending = await ctx.db
      .query("loans")
      .withIndex("by_tool_borrower_status", (q) =>
        q.eq("toolId", toolId).eq("borrowerId", viewer._id).eq("status", "pending"),
      )
      .collect();
    if (myPending.some((loan) => rangesOverlap(loan.startDate, loan.endDate, startDate, endDate))) {
      fail("CONFLICT", "You already have a pending request for these dates.");
    }

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId,
      borrowerId: viewer._id,
      lenderId: tool.ownerId,
      startDate,
      endDate,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await enqueueLoanEvent(ctx, { loanId, type: "loan.requested", recipientId: tool.ownerId, actorId: viewer._id });
    return loanId;
  },
});

/** Applies one state-machine action (lib/loans.ts) and enqueues its notification. */
export const transition = mutation({
  args: { loanId: v.id("loans"), action: vLoanAction },
  handler: async (ctx, { loanId, action }) => {
    const viewer = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) fail("NOT_FOUND", "Loan not found.");
    const today = todayUtc();
    const check = checkTransition(loan, viewer._id, action, today);
    if (!check.ok) {
      if (check.code === "FORBIDDEN") fail("FORBIDDEN", "You can't do that on this loan.");
      if (action === "approve" && loan.status === "pending" && isExpired(loan, today)) {
        fail("CONFLICT", "These dates have passed. Decline the request instead.");
      }
      if ((action === "cancel" || action === "revoke") && loan.status === "approved") {
        fail("CONFLICT", "This loan has already started, so it can only be returned now.");
      }
      fail("CONFLICT", "This loan has changed. Refresh and try again.");
    }
    const now = Date.now();

    if (action === "approve") {
      const overlaps = (other: Doc<"loans">) => rangesOverlap(other.startDate, other.endDate, loan.startDate, loan.endDate);
      if ((await activeLoansOfTool(ctx, loan.toolId)).some(overlaps)) {
        fail("CONFLICT", "The tool is already lent out for some of these dates.");
      }
      // Other requests for the same dates can no longer be met: decline them now and tell
      // their borrowers ("dates no longer available"). The system is the actor.
      const pending = await ctx.db
        .query("loans")
        .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "pending"))
        .collect();
      for (const other of pending) {
        if (other._id === loan._id || !overlaps(other)) continue;
        await ctx.db.patch(other._id, { status: "declined", decidedAt: now, updatedAt: now });
        await enqueueLoanEvent(ctx, { loanId: other._id, type: "loan.declined", recipientId: other.borrowerId });
      }
    }

    const timestamps =
      action === "approve" || action === "decline" || action === "cancel" || action === "revoke"
        ? { decidedAt: now }
        : action === "claim_return"
          ? { returnClaimedAt: now }
          : action === "dispute_return"
            ? { returnClaimedAt: undefined } // the claim was rejected; the loan is plainly approved again
            : { returnedAt: now }; // confirm_return, mark_returned
    await ctx.db.patch(loanId, { status: check.to, ...timestamps, updatedAt: now });

    const { event, notify } = check.transition;
    await enqueueLoanEvent(ctx, {
      loanId,
      type: event,
      recipientId: notify === "lender" ? loan.lenderId : loan.borrowerId,
      actorId: viewer._id,
    });
  },
});

// ---- Read models --------------------------------------------------------------------------

/**
 * What a party (or an admin) sees in a list. People appear by name only: no user ids, no
 * emails. `allowedActions` is computed for the viewer, so the UI only renders what the server
 * would accept.
 */
async function toRow(ctx: QueryCtx, loan: Doc<"loans">, viewerId: Id<"users">, today: string) {
  const [tool, borrower, lender, latest] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.borrowerId),
    ctx.db.get(loan.lenderId),
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .order("desc")
      .first(),
  ]);
  return {
    _id: loan._id,
    status: loan.status,
    startDate: loan.startDate,
    endDate: loan.endDate,
    tool: { _id: loan.toolId, name: tool?.name ?? "Removed tool" },
    borrower: { name: borrower?.name ?? "Unknown" },
    lender: { name: lender?.name ?? "Unknown", trustedLender: lender?.trustedLender ?? false },
    overdue: isOverdue(loan, today),
    allowedActions: allowedActions(loan, viewerId, today),
    expired: isExpired(loan, today),
    // Which side the viewer is on, so the UI never has to guess from names. Null for an admin
    // who is not a party.
    viewerRole: (loan.lenderId === viewerId ? "lender" : loan.borrowerId === viewerId ? "borrower" : null) as
      | "lender"
      | "borrower"
      | null,
    lastActivity: latest ? { kind: latest.kind, detail: latest.detail, at: latest.at } : null,
  };
}

export type LoanRow = Awaited<ReturnType<typeof toRow>>;

async function toRows(ctx: QueryCtx, loans: Doc<"loans">[], viewerId: Id<"users">) {
  const today = todayUtc();
  const newestFirst = [...loans].sort((a, b) => b.createdAt - a.createdAt);
  return Promise.all(newestFirst.map((loan) => toRow(ctx, loan, viewerId, today)));
}

/** Loans where the viewer is the borrower. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .collect();
    return toRows(ctx, loans, viewer._id);
  },
});

/** Loans on the viewer's tools. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", viewer._id))
      .collect();
    return toRows(ctx, loans, viewer._id);
  },
});

/** Timeline labels, one per event the loan emitted. Events with no actor were system actions. */
const TIMELINE_LABELS: Record<EventType, string> = {
  "loan.requested": "Requested",
  "loan.approved": "Approved",
  "loan.declined": "Declined",
  "loan.cancelled": "Cancelled",
  "loan.return_claimed": "Borrower reported it returned",
  "loan.returned": "Returned",
  "loan.return_disputed": "Return disputed by the lender",
};
const SYSTEM_TIMELINE_LABELS: Partial<Record<EventType, string>> = {
  "loan.declined": "Declined: dates no longer available",
  "loan.cancelled": "Cancelled: listing removed",
};

/**
 * Whether the two parties may see each other's email: from approval until CONTACT_WINDOW_DAYS
 * after the return, long enough to sort out a late question, not forever.
 */
function contactVisible(loan: Doc<"loans">, now: number): boolean {
  if ((ACTIVE_STATUSES as readonly string[]).includes(loan.status)) return true;
  return loan.status === "returned" && now - (loan.returnedAt ?? 0) <= CONTACT_WINDOW_DAYS * 86_400_000;
}

/**
 * Loan detail for a party or an admin. The counterpart's email is shown only to a party and
 * only once the loan was approved (spec §5); an admin who is not a party never gets it.
 */
export const get = query({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) fail("NOT_FOUND", "Loan not found.");
    const isParty = viewer._id === loan.borrowerId || viewer._id === loan.lenderId;
    if (!isParty && viewer.role !== "admin") fail("FORBIDDEN", "You can't view this loan.");

    let counterpartEmail: string | null = null;
    if (isParty && contactVisible(loan, Date.now())) {
      const counterpart = await ctx.db.get(viewer._id === loan.borrowerId ? loan.lenderId : loan.borrowerId);
      counterpartEmail = counterpart?.email ?? null;
    }

    const events = await ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .order("desc")
      .take(50);
    // Every transition enqueues exactly one outbox row, so the outbox doubles as the
    // status history: no separate history table to keep in sync.
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .collect();
    const timeline = deliveries
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((d) => ({
        label: (!d.actorId && SYSTEM_TIMELINE_LABELS[d.type]) || TIMELINE_LABELS[d.type],
        at: d.createdAt,
      }));

    return {
      ...(await toRow(ctx, loan, viewer._id, todayUtc())),
      counterpartEmail,
      activity: events.map((e) => ({ kind: e.kind, detail: e.detail, at: e.at })),
      timeline,
    };
  },
});

/** All loans, for admins. `overdueOnly` narrows to approved loans past their end date. */
export const adminList = query({
  args: { status: v.optional(vLoanStatus), overdueOnly: v.optional(v.boolean()) },
  handler: async (ctx, { status, overdueOnly }) => {
    const admin = await requireAdmin(ctx);
    let loans: Doc<"loans">[];
    if (overdueOnly) {
      if (status && status !== "approved") return [];
      const today = todayUtc();
      loans = await ctx.db
        .query("loans")
        .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", today))
        .collect();
    } else if (status) {
      loans = await ctx.db
        .query("loans")
        .withIndex("by_status_endDate", (q) => q.eq("status", status))
        .collect();
    } else {
      loans = await ctx.db.query("loans").order("desc").take(500);
    }
    return toRows(ctx, loans, admin._id);
  },
});
