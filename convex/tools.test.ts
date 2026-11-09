import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { errorOf, identity, insertLoan, insertTool, insertUser, setup } from "./lib/test.helpers";

const NOW = Date.UTC(2026, 10, 9, 12, 0); // 2026-11-09 12:00 UTC

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const newTool = {
  name: "  Cordless drill  ",
  category: "power_tools" as const,
  condition: "good" as const,
  description: "Two batteries",
};

describe("tools.listPublic", () => {
  test("listPublic exposes only id, name, category", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    await t.run(async (ctx) => {
      const base = { ownerId: ana, condition: "good" as const, description: "x", createdAt: 1, updatedAt: 1 };
      await ctx.db.insert("tools", { ...base, name: "Drill", category: "power_tools", status: "active" });
      await ctx.db.insert("tools", { ...base, name: "Hidden", category: "garden", status: "removed", removedAt: 2 });
    });
    const rows = await t.query(api.tools.listPublic, {});
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["_id", "category", "name"]);
    expect(rows[0]).toMatchObject({ name: "Drill", category: "power_tools" });
  });
});

describe("tools for signed-in users", () => {
  test("list requires auth", async () => {
    const t = setup();
    expect((await errorOf(t.query(api.tools.list, {}))).code).toBe("UNAUTHENTICATED");
  });

  test("list filters by category and never exposes owner ids or emails", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana", "user", true);
    await insertUser(t, "joao");
    await insertTool(t, ana, { name: "Drill", category: "power_tools", createdAt: 1 });
    await insertTool(t, ana, { name: "Rake", category: "garden", createdAt: 2 });
    await insertTool(t, ana, { name: "Old saw", category: "garden", status: "removed", createdAt: 3 });

    const all = await t.withIdentity(identity("joao")).query(api.tools.list, {});
    expect(all.map((c) => c.name)).toEqual(["Rake", "Drill"]); // newest first, removed excluded

    const garden = await t.withIdentity(identity("joao")).query(api.tools.list, { category: "garden" });
    expect(garden.map((c) => c.name)).toEqual(["Rake"]);
    expect(Object.keys(garden[0]).sort()).toEqual(
      ["_id", "availability", "category", "condition", "description", "isMine", "name", "owner"].sort(),
    );
    expect(garden[0].owner).toEqual({ name: "Ana", trustedLender: true });
    expect(garden[0].isMine).toBe(false);

    const mineView = await t.withIdentity(identity("ana")).query(api.tools.list, { category: "garden" });
    expect(mineView[0].isMine).toBe(true);
  });

  test("get returns a card, or null for removed tools", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    const active = await insertTool(t, ana);
    const removed = await insertTool(t, ana, { status: "removed" });
    const card = await t.withIdentity(identity("ana")).query(api.tools.get, { toolId: active });
    expect(card).toMatchObject({ _id: active, name: "Drill", isMine: true, availability: { state: "available" } });
    expect(await t.withIdentity(identity("ana")).query(api.tools.get, { toolId: removed })).toBeNull();
  });

  test("create trims and validates, update edits", async () => {
    const t = setup();
    await insertUser(t, "ana");
    const asAna = t.withIdentity(identity("ana"));
    const toolId = await asAna.mutation(api.tools.create, newTool);
    const row = await t.run((ctx) => ctx.db.get(toolId));
    expect(row).toMatchObject({ name: "Cordless drill", status: "active" });

    expect((await errorOf(asAna.mutation(api.tools.create, { ...newTool, name: "   " }))).code).toBe("INVALID");
    expect(
      (await errorOf(asAna.mutation(api.tools.create, { ...newTool, description: "x".repeat(281) }))).code,
    ).toBe("INVALID");
    expect((await errorOf(t.mutation(api.tools.create, newTool))).code).toBe("UNAUTHENTICATED");

    await asAna.mutation(api.tools.update, { toolId, ...newTool, name: "Hammer drill", condition: "fair" });
    expect(await t.run((ctx) => ctx.db.get(toolId))).toMatchObject({ name: "Hammer drill", condition: "fair" });
  });

  test("update and remove are owner-only", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    await insertUser(t, "joao");
    await insertUser(t, "root", "admin");
    const toolId = await insertTool(t, ana);

    for (const who of ["joao", "root"]) {
      const as = t.withIdentity(identity(who));
      expect((await errorOf(as.mutation(api.tools.update, { toolId, ...newTool }))).code).toBe("FORBIDDEN");
      expect((await errorOf(as.mutation(api.tools.remove, { toolId }))).code).toBe("FORBIDDEN");
    }
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.status).toBe("active");

    await t.withIdentity(identity("ana")).mutation(api.tools.remove, { toolId });
    expect(await t.run((ctx) => ctx.db.get(toolId))).toMatchObject({ status: "removed", removedBy: ana });
  });

  test("remove is blocked while a loan is out", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    const joao = await insertUser(t, "joao");
    const toolId = await insertTool(t, ana);
    for (const status of ["approved", "return_claimed"] as const) {
      const loanId = await insertLoan(t, { toolId, borrowerId: joao, startDate: "2026-11-08", endDate: "2026-11-12", status });
      const err = await errorOf(t.withIdentity(identity("ana")).mutation(api.tools.remove, { toolId }));
      expect(err.code).toBe("CONFLICT");
      await t.run((ctx) => ctx.db.patch(loanId, { status: "returned" }));
    }
    await t.withIdentity(identity("ana")).mutation(api.tools.remove, { toolId });
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.status).toBe("removed");
  });

  test("adminRemove works with a loan out and keeps the loan approved", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    const joao = await insertUser(t, "joao");
    const root = await insertUser(t, "root", "admin");
    const toolId = await insertTool(t, ana);
    const loanId = await insertLoan(t, { toolId, borrowerId: joao, startDate: "2026-11-08", endDate: "2026-11-12", status: "approved" });

    await t.withIdentity(identity("root")).mutation(api.tools.adminRemove, { toolId, reason: "  Unsafe item  " });

    expect(await t.run((ctx) => ctx.db.get(toolId))).toMatchObject({
      status: "removed",
      removedBy: root,
      removedReason: "Unsafe item",
    });
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.status).toBe("approved");
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: root, action: "tool.removed", targetType: "tool", targetId: toolId });
    expect(await t.withIdentity(identity("joao")).query(api.tools.list, {})).toEqual([]);
  });

  test("adminRemove requires admin and a 3–200 char reason", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    await insertUser(t, "root", "admin");
    const toolId = await insertTool(t, ana);

    const asOwner = t.withIdentity(identity("ana"));
    expect((await errorOf(asOwner.mutation(api.tools.adminRemove, { toolId, reason: "Spam listing" }))).code).toBe(
      "FORBIDDEN",
    );
    const asRoot = t.withIdentity(identity("root"));
    expect((await errorOf(asRoot.mutation(api.tools.adminRemove, { toolId, reason: " ab " }))).code).toBe("INVALID");
    expect((await errorOf(asRoot.mutation(api.tools.adminRemove, { toolId, reason: "x".repeat(201) }))).code).toBe(
      "INVALID",
    );
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.status).toBe("active");
    await asRoot.mutation(api.tools.adminRemove, { toolId, reason: "abc" });
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.status).toBe("removed");
  });

  test("availability shows on_loan until endDate", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    const joao = await insertUser(t, "joao");
    const toolId = await insertTool(t, ana);
    const asJoao = t.withIdentity(identity("joao"));

    // A pending request and a future approved loan don't make the tool unavailable today.
    await insertLoan(t, { toolId, borrowerId: joao, startDate: "2026-11-09", endDate: "2026-11-10", status: "pending" });
    await insertLoan(t, { toolId, borrowerId: joao, startDate: "2026-11-20", endDate: "2026-11-22", status: "approved" });
    expect((await asJoao.query(api.tools.get, { toolId }))?.availability).toEqual({ state: "available" });

    // Today (2026-11-09) is inside 2026-11-07..2026-11-09: on loan, inclusive of the end date.
    const loanId = await insertLoan(t, { toolId, borrowerId: joao, startDate: "2026-11-07", endDate: "2026-11-09", status: "approved" });
    expect((await asJoao.query(api.tools.get, { toolId }))?.availability).toEqual({ state: "on_loan", until: "2026-11-09" });
    await t.run((ctx) => ctx.db.patch(loanId, { status: "return_claimed" }));
    expect((await asJoao.query(api.tools.get, { toolId }))?.availability).toEqual({ state: "on_loan", until: "2026-11-09" });

    // Past the end date the tool is still out (the return is only claimed): still on loan.
    vi.setSystemTime(Date.UTC(2026, 10, 10, 0, 1));
    expect((await asJoao.query(api.tools.get, { toolId }))?.availability).toEqual({ state: "on_loan", until: "2026-11-09" });

    // Once the lender confirms the return, it is available again.
    await t.run((ctx) => ctx.db.patch(loanId, { status: "returned" }));
    expect((await asJoao.query(api.tools.get, { toolId }))?.availability).toEqual({ state: "available" });
  });

  test("mine lists the viewer's active tools with pending request counts", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    const joao = await insertUser(t, "joao");
    const drill = await insertTool(t, ana, { name: "Drill", createdAt: 1 });
    await insertTool(t, ana, { name: "Gone", status: "removed", createdAt: 2 });
    await insertTool(t, joao, { name: "Joao's saw", createdAt: 3 });
    await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-10", endDate: "2026-11-11", status: "pending" });
    await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-15", endDate: "2026-11-16", status: "pending" });
    await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-01", endDate: "2026-11-02", status: "declined" });

    const mine = await t.withIdentity(identity("ana")).query(api.tools.mine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: "Drill", isMine: true, pendingRequests: 2 });
  });
});

describe("availability of overdue loans", () => {
  test("a tool whose approved loan is past its end date still shows as on loan", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    const joao = await insertUser(t, "joao");
    const drill = await insertTool(t, ana, { name: "Drill" });
    const today = new Date().toISOString().slice(0, 10);
    const daysAgo = (n: number) => new Date(Date.parse(today) - n * 86_400_000).toISOString().slice(0, 10);
    await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: daysAgo(10), endDate: daysAgo(3), status: "approved" });

    const [card] = await t.withIdentity(identity("joao")).query(api.tools.list, {});
    expect(card.availability).toEqual({ state: "on_loan", until: daysAgo(3) });
  });

  test("a future approved loan does not make the tool unavailable today", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    const joao = await insertUser(t, "joao");
    const drill = await insertTool(t, ana, { name: "Drill" });
    const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: inDays(5), endDate: inDays(7), status: "approved" });

    const [card] = await t.withIdentity(identity("joao")).query(api.tools.list, {});
    expect(card.availability).toEqual({ state: "available" });
  });
});
