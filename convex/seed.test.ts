import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { CATEGORY_VALUES, LOAN_STATUSES, TOOL_DESCRIPTION_MAX, TOOL_NAME_MAX } from "./lib/constants";
import { addDays, todayUtc } from "./lib/dates";
import { errorOf, insertUser, setup, type TestConvex } from "./lib/test.helpers";

// Fake timers keep the scheduled outbox sends from running.
const NOW = Date.UTC(2026, 10, 9, 12, 0);
const TODAY = todayUtc(NOW);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const all = (t: TestConvex) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").collect(),
    tools: await ctx.db.query("tools").collect(),
    loans: await ctx.db.query("loans").collect(),
    deliveries: await ctx.db.query("webhookDeliveries").collect(),
  }));

describe("seed.dev", () => {
  test("creates neighbors, tools in every category and loans in every status", async () => {
    const t = setup();
    expect(await t.mutation(internal.seed.dev, {})).toMatchObject({ base: { users: 3, tools: 10, loans: 8 } });
    const { users, tools, loans } = await all(t);

    expect(users.map((u) => u.clerkId).sort()).toEqual(["seed|ana", "seed|joao", "seed|mei"]);
    expect(users.every((u) => u.email.endsWith("@example.test"))).toBe(true);
    expect(users.find((u) => u.clerkId === "seed|ana")).toMatchObject({ name: "Ana Souza", trustedLender: true });
    expect(users.find((u) => u.clerkId === "seed|joao")?.name).toBe("João Pereira");

    expect(new Set(tools.map((x) => x.category))).toEqual(new Set(CATEGORY_VALUES));
    expect(tools.map((x) => x.name)).toContain("<b>Drill</b> & Saw");
    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(TOOL_NAME_MAX);
      expect(tool.description.length).toBeLessThanOrEqual(TOOL_DESCRIPTION_MAX);
      expect(tool.status).toBe("active");
    }

    expect(new Set(loans.map((l) => l.status))).toEqual(new Set(LOAN_STATUSES));
    expect(loans.some((l) => l.status === "approved" && l.endDate === addDays(TODAY, -3))).toBe(true);
    for (const loan of loans) {
      expect(loan.lenderId).toBe(tools.find((x) => x._id === loan.toolId)?.ownerId);
      expect(loan.borrowerId).not.toBe(loan.lenderId);
    }
  });

  test("pending and approved loans send their event through the outbox", async () => {
    const t = setup();
    await t.mutation(internal.seed.dev, {});
    const { users, loans, deliveries } = await all(t);
    const live = deliveries.filter((d) => d.status === "pending");
    const nameOf = (id: string) => users.find((u) => u._id === id)?.name;

    // One live event per pending (to the lender) and approved (to the borrower) loan.
    const expected = loans
      .filter((l) => l.status === "pending" || l.status === "approved")
      .map((l) =>
        l.status === "pending"
          ? { loanId: l._id, type: "loan.requested", recipientId: l.lenderId }
          : { loanId: l._id, type: "loan.approved", recipientId: l.borrowerId },
      );
    expect(live.map((d) => ({ loanId: d.loanId, type: d.type, recipientId: d.recipientId }))).toEqual(
      expect.arrayContaining(expected),
    );
    expect(live).toHaveLength(4);
    const drillRequest = live.find((d) => d.type === "loan.requested" && nameOf(d.actorId!) === "João Pereira");
    expect(nameOf(drillRequest!.recipientId)).toBe("Ana Souza");

    // History rows are already delivered and are never sent again.
    for (const d of deliveries.filter((x) => x.status !== "pending")) expect(d).toMatchObject({ status: "sent", notifyStatus: "sent" });
    // The return_claimed loan's timeline ends with the claim.
    const claimed = loans.find((l) => l.status === "return_claimed")!;
    const last = deliveries.filter((d) => d.loanId === claimed._id).sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(last.type).toBe("loan.return_claimed");
  });

  test("is idempotent", async () => {
    const t = setup();
    await t.mutation(internal.seed.dev, {});
    const before = await all(t);
    expect(await t.mutation(internal.seed.dev, {})).toEqual({ base: "already seeded" });
    const after = await all(t);
    expect(after.tools).toHaveLength(before.tools.length);
    expect(after.loans).toHaveLength(before.loans.length);
    expect(after.deliveries).toHaveLength(before.deliveries.length);
  });

  test("attachEmail gives an existing account an incoming request and an overdue loan, once", async () => {
    const t = setup();
    const me = await insertUser(t, "willian");
    await t.mutation(internal.seed.dev, {}); // base first, attach later
    expect(await t.mutation(internal.seed.dev, { attachEmail: " Willian@Example.test " })).toEqual({
      base: "already seeded",
      attached: "attached",
    });
    const { users, tools, loans, deliveries } = await all(t);
    const joao = users.find((u) => u.clerkId === "seed|joao")!;

    expect(tools.filter((x) => x.ownerId === me)).toHaveLength(2);
    const incoming = loans.filter((l) => l.lenderId === me);
    expect(incoming).toMatchObject([{ status: "pending", borrowerId: joao._id }]);
    const borrowed = loans.filter((l) => l.borrowerId === me);
    expect(borrowed).toHaveLength(1);
    expect(borrowed[0].status).toBe("approved");
    expect(borrowed[0].endDate < TODAY).toBe(true);
    const mine = deliveries.filter((d) => d.status === "pending" && d.recipientId === me).map((d) => d.type);
    expect(mine.sort()).toEqual(["loan.approved", "loan.requested"]);

    expect(await t.mutation(internal.seed.dev, { attachEmail: "willian@example.test" })).toEqual({
      base: "already seeded",
      attached: "already attached",
    });
    expect((await all(t)).loans).toHaveLength(loans.length);
  });

  test("attachEmail on a fresh database seeds the base too", async () => {
    const t = setup();
    await insertUser(t, "willian");
    expect(await t.mutation(internal.seed.dev, { attachEmail: "willian@example.test" })).toMatchObject({
      base: { loans: 8 },
      attached: "attached",
    });
  });

  test("an unknown attachEmail fails before creating anything", async () => {
    const t = setup();
    expect((await errorOf(t.mutation(internal.seed.dev, { attachEmail: "nobody@example.test" }))).code).toBe("NOT_FOUND");
    expect((await all(t)).users).toHaveLength(0);
  });
});

describe("devtools smoke fixture", () => {
  test("creates fresh events each run, cleans up, and stays out of the seed's numbers", async () => {
    const t = setup();
    await t.mutation(internal.seed.dev, {});
    const seeded = await all(t);

    const first = await t.mutation(internal.devtools.createSmokeFixture, {});
    expect(first.purged).toBe(0);
    const second = await t.mutation(internal.devtools.createSmokeFixture, {});
    expect(second.purged).toBe(2); // a failed run's leftovers are deleted first

    const state = await t.query(internal.devtools.loanAutomationState, {
      loanIds: [second.requestedLoanId, second.overdueLoanId],
    });
    expect(state.map((s) => s.deliveries.map((d) => [d.type, d.recipientName, d.actorName]))).toEqual([
      [["loan.requested", "Ana Souza", "João Pereira"]],
      [["loan.approved", "João Pereira", "Ana Souza"]],
    ]);
    const overdue = await t.query(internal.automation.overdueLoans, { today: TODAY });
    expect(overdue.map((l) => l.loanId)).toContain(second.overdueLoanId);
    expect(await t.query(internal.devtools.seedDeliveries, {})).toHaveLength(seeded.deliveries.length);

    // Fixture tools are never on the board.
    const { tools } = await all(t);
    expect(tools.filter((x) => x.status === "active")).toHaveLength(seeded.tools.length);

    expect(await t.mutation(internal.devtools.deleteSmokeFixture, {})).toBe(2);
    const after = await all(t);
    expect(after.tools).toHaveLength(seeded.tools.length);
    expect(after.loans).toHaveLength(seeded.loans.length);
    expect(after.deliveries).toHaveLength(seeded.deliveries.length);
  });

  test("needs the seed", async () => {
    const t = setup();
    expect((await errorOf(t.mutation(internal.devtools.createSmokeFixture, {}))).code).toBe("NOT_FOUND");
  });
});
