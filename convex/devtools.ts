// Internal helpers for scripts/e2e-smoke.ts. Not callable from the app: only the deployment
// admin key (the Convex CLI, the smoke script) can run them.
//
// The smoke test needs a fresh loan event and a fresh overdue loan on every run (reminders are
// once per loan per day, and the seed runs once). So each run creates a small fixture owned by
// the seeded neighbors, sends its events through the real outbox, and deletes it afterwards.
// The fixture's tools are created already "removed" (the state an admin removal leaves behind),
// so they never show up on the board, and the fixture never touches the demo data.
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { addDays, todayUtc } from "./lib/dates";
import { fail } from "./lib/errors";
import { enqueueLoanEvent } from "./lib/outbox";

/** Marks fixture tools; anything carrying it belongs to the smoke test and may be deleted. */
const FIXTURE_REASON = "e2e smoke-test fixture";

async function seedUser(ctx: QueryCtx, clerkId: string): Promise<Doc<"users">> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .unique();
  if (!user) fail("NOT_FOUND", "Seed data missing: run `npx convex run seed:dev` first.");
  return user;
}

async function fixtureTools(ctx: QueryCtx, ownerId: Id<"users">): Promise<Doc<"tools">[]> {
  const tools = await ctx.db
    .query("tools")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  return tools.filter((t) => t.status === "removed" && t.removedReason === FIXTURE_REASON);
}

/** Hard-deletes fixture tools and every row hanging off their loans. Dev only. */
async function purge(ctx: MutationCtx, ownerId: Id<"users">): Promise<number> {
  const tools = await fixtureTools(ctx, ownerId);
  for (const tool of tools) {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id))
      .collect();
    for (const loan of loans) {
      for (const table of ["webhookDeliveries", "reminders", "automationEvents"] as const) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
          .collect();
        for (const row of rows) await ctx.db.delete(row._id);
      }
      await ctx.db.delete(loan._id);
    }
    await ctx.db.delete(tool._id);
  }
  return tools.length;
}

/**
 * Creates this run's fixture (after deleting any left by a failed run):
 * - a pending request from João for Ana's "<b>Drill</b> & Saw" → `loan.requested` to Ana;
 * - an approved loan of Ana's "Tesoura de poda — jardim" to João that ended 3 days ago →
 *   `loan.approved` to João now, and an overdue reminder on the next Overdue run.
 */
export const createSmokeFixture = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ana = await seedUser(ctx, "seed|ana");
    const joao = await seedUser(ctx, "seed|joao");
    const purged = await purge(ctx, ana._id);
    const now = Date.now();
    const today = todayUtc(now);

    const tool = (name: string, category: Doc<"tools">["category"]) =>
      ctx.db.insert("tools", {
        ownerId: ana._id,
        name,
        category,
        condition: "good",
        description: "Created and deleted by scripts/e2e-smoke.ts.",
        status: "removed",
        removedAt: now,
        removedBy: ana._id,
        removedReason: FIXTURE_REASON,
        createdAt: now,
        updatedAt: now,
      });
    const loan = (toolId: Id<"tools">, status: "pending" | "approved", startDate: string, endDate: string) =>
      ctx.db.insert("loans", {
        toolId,
        borrowerId: joao._id,
        lenderId: ana._id,
        startDate,
        endDate,
        status,
        decidedAt: status === "approved" ? now : undefined,
        createdAt: now,
        updatedAt: now,
      });

    const requestedLoanId = await loan(await tool("<b>Drill</b> & Saw", "power_tools"), "pending", addDays(today, 2), addDays(today, 4));
    await enqueueLoanEvent(ctx, { loanId: requestedLoanId, type: "loan.requested", recipientId: ana._id, actorId: joao._id });

    const overdueLoanId = await loan(await tool("Tesoura de poda — jardim", "garden"), "approved", addDays(today, -10), addDays(today, -3));
    await enqueueLoanEvent(ctx, { loanId: overdueLoanId, type: "loan.approved", recipientId: joao._id, actorId: ana._id });

    return {
      purged,
      today,
      requestedLoanId,
      overdueLoanId,
      lender: { name: ana.name, email: ana.email },
      borrower: { name: joao.name, email: joao.email },
    };
  },
});

/** Deletes the fixture. Returns how many fixture tools were removed. */
export const deleteSmokeFixture = internalMutation({
  args: {},
  handler: async (ctx) => purge(ctx, (await seedUser(ctx, "seed|ana"))._id),
});

const deliveryView = async (ctx: QueryCtx, d: Doc<"webhookDeliveries">) => ({
  eventId: d.eventId,
  type: d.type,
  status: d.status,
  notifyStatus: d.notifyStatus ?? null,
  // n8n claims every event it handles; rows the seed inserted as history were never claimed.
  viaN8n: d.claimedAt !== undefined,
  attempts: d.attempts,
  lastError: d.lastError ?? null,
  recipientName: (await ctx.db.get(d.recipientId))?.name ?? null,
  actorName: d.actorId ? ((await ctx.db.get(d.actorId))?.name ?? null) : null,
});

/** Outbox rows, reminders and activity of the given loans. Read-only. */
export const loanAutomationState = internalQuery({
  args: { loanIds: v.array(v.id("loans")) },
  handler: async (ctx, { loanIds }) =>
    Promise.all(
      loanIds.map(async (loanId) => {
        const deliveries = await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_loan", (q) => q.eq("loanId", loanId))
          .collect();
        const reminders = await ctx.db
          .query("reminders")
          .withIndex("by_loan", (q) => q.eq("loanId", loanId))
          .collect();
        const events = await ctx.db
          .query("automationEvents")
          .withIndex("by_loan", (q) => q.eq("loanId", loanId))
          .collect();
        return {
          loanId,
          deliveries: await Promise.all(deliveries.map((d) => deliveryView(ctx, d))),
          reminders: reminders.map((r) => ({ reminderKey: r.reminderKey, status: r.status, n8nExecutionId: r.n8nExecutionId ?? null })),
          events: events.map((e) => ({ kind: e.kind, detail: e.detail })),
        };
      }),
    ),
});

/** Outbox rows of every loan with a seeded neighbor as a party (fixture excluded). Read-only. */
export const seedDeliveries = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await Promise.all(
      ["seed|ana", "seed|joao", "seed|mei"].map((clerkId) =>
        ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
          .unique(),
      ),
    );
    const ids = users.filter((u) => u !== null).map((u) => u._id);
    const loans = new Map<Id<"loans">, Doc<"loans">>();
    for (const id of ids) {
      const lent = await ctx.db
        .query("loans")
        .withIndex("by_lender", (q) => q.eq("lenderId", id))
        .collect();
      const borrowed = await ctx.db
        .query("loans")
        .withIndex("by_borrower", (q) => q.eq("borrowerId", id))
        .collect();
      for (const loan of [...lent, ...borrowed]) loans.set(loan._id, loan);
    }
    const out = [];
    for (const loan of loans.values()) {
      const tool = await ctx.db.get(loan.toolId);
      if (tool?.removedReason === FIXTURE_REASON) continue;
      const deliveries = await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
        .collect();
      for (const d of deliveries) out.push(await deliveryView(ctx, d));
    }
    return out;
  },
});
