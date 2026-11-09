import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { LoanStatus } from "./lib/constants";
import type { LoanAction } from "./lib/loans";
import { errorOf, identity, insertLoan, insertTool, insertUser, setup, type TestConvex } from "./lib/test.helpers";

// 2026-11-09 12:00 UTC. Fake timers also keep the scheduled outbox sends from running.
const NOW = Date.UTC(2026, 10, 9, 12, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

/** ana lends a drill; joao and mei borrow; root is an admin who is party to nothing. */
async function world() {
  const t = setup();
  const ana = await insertUser(t, "ana", "user", true);
  const joao = await insertUser(t, "joao");
  const mei = await insertUser(t, "mei");
  const root = await insertUser(t, "root", "admin");
  const drill = await insertTool(t, ana, { name: "Drill" });
  const as = (key: string) => t.withIdentity(identity(key));
  return { t, ana, joao, mei, root, drill, as };
}

const deliveries = (t: TestConvex) => t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
const loanRow = (t: TestConvex, id: Id<"loans">) => t.run((ctx) => ctx.db.get(id));
const loanAt = (t: TestConvex, toolId: Id<"tools">, borrowerId: Id<"users">, status: LoanStatus, startDate = "2026-11-10", endDate = "2026-11-12") =>
  insertLoan(t, { toolId, borrowerId, startDate, endDate, status });

describe("loans.request", () => {
  test("request validates dates", async () => {
    const { drill, as } = await world();
    const request = (startDate: string, endDate: string) => as("joao").mutation(api.loans.request, { toolId: drill, startDate, endDate });

    expect((await errorOf(request("2026-11-07", "2026-11-08"))).code).toBe("INVALID"); // 2 days ago
    // Yesterday in UTC is still "today" for someone west of UTC (Review Focus 1).
    expect(await request("2026-11-08", "2026-11-08")).toBeTruthy();
    expect((await errorOf(request("2026-11-12", "2026-11-11"))).code).toBe("INVALID"); // end before start
    expect((await errorOf(request("2026-11-20", "2026-12-20"))).code).toBe("INVALID"); // 31 days
    expect(await request("2026-11-20", "2026-12-19")).toBeTruthy(); // exactly 30 days
    expect((await errorOf(request("2026-11-31", "2026-12-01"))).code).toBe("INVALID"); // not a date
    expect((await errorOf(request("11/20/2026", "2026-12-01"))).code).toBe("INVALID");
  });

  test("request creates a pending loan and notifies the lender", async () => {
    const { t, ana, joao, drill, as } = await world();
    const loanId = await as("joao").mutation(api.loans.request, { toolId: drill, startDate: "2026-11-10", endDate: "2026-11-12" });
    expect(await loanRow(t, loanId)).toMatchObject({ status: "pending", borrowerId: joao, lenderId: ana, toolId: drill });
    const rows = await deliveries(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ loanId, type: "loan.requested", recipientId: ana, actorId: joao, status: "pending" });
  });

  test("request requires auth", async () => {
    const { t, drill } = await world();
    const err = await errorOf(t.mutation(api.loans.request, { toolId: drill, startDate: "2026-11-10", endDate: "2026-11-12" }));
    expect(err.code).toBe("UNAUTHENTICATED");
  });

  test("cannot request own or removed tool", async () => {
    const { t, ana, drill, as } = await world();
    const dates = { startDate: "2026-11-10", endDate: "2026-11-12" };
    expect((await errorOf(as("ana").mutation(api.loans.request, { toolId: drill, ...dates }))).code).toBe("FORBIDDEN");
    const gone = await insertTool(t, ana, { name: "Gone", status: "removed" });
    expect((await errorOf(as("joao").mutation(api.loans.request, { toolId: gone, ...dates }))).code).toBe("NOT_FOUND");
    expect(await deliveries(t)).toHaveLength(0);
  });

  test("duplicate overlapping request is CONFLICT", async () => {
    const { t, drill, as } = await world();
    const request = (startDate: string, endDate: string) => as("joao").mutation(api.loans.request, { toolId: drill, startDate, endDate });
    await request("2026-11-10", "2026-11-12");
    // Double tap (Review Focus 5), and a range that only touches the first one.
    expect((await errorOf(request("2026-11-10", "2026-11-12"))).code).toBe("CONFLICT");
    expect((await errorOf(request("2026-11-12", "2026-11-14"))).code).toBe("CONFLICT");
    // Non-overlapping dates, or another borrower, are fine.
    await request("2026-11-13", "2026-11-14");
    await as("mei").mutation(api.loans.request, { toolId: drill, startDate: "2026-11-10", endDate: "2026-11-12" });
    expect(await t.run((ctx) => ctx.db.query("loans").collect())).toHaveLength(3);
  });
});

describe("loans.transition", () => {
  test("only the lender approves or declines; only the borrower cancels or claims return", async () => {
    const { t, drill, joao, as } = await world();
    const pending = await loanAt(t, drill, joao, "pending");
    const approved = await loanAt(t, drill, joao, "approved", "2026-11-20", "2026-11-22");

    for (const who of ["joao", "mei", "root"]) {
      for (const action of ["approve", "decline"] as const) {
        expect((await errorOf(as(who).mutation(api.loans.transition, { loanId: pending, action }))).code).toBe("FORBIDDEN");
      }
    }
    for (const who of ["ana", "mei", "root"]) {
      expect((await errorOf(as(who).mutation(api.loans.transition, { loanId: pending, action: "cancel" }))).code).toBe("FORBIDDEN");
      expect((await errorOf(as(who).mutation(api.loans.transition, { loanId: approved, action: "claim_return" }))).code).toBe(
        "FORBIDDEN",
      );
    }
    for (const who of ["joao", "mei", "root"]) {
      expect((await errorOf(as(who).mutation(api.loans.transition, { loanId: approved, action: "mark_returned" }))).code).toBe(
        "FORBIDDEN",
      );
    }
    expect((await loanRow(t, pending))?.status).toBe("pending");
    expect((await loanRow(t, approved))?.status).toBe("approved");
    expect(await deliveries(t)).toHaveLength(0);

    // A wrong state from the right actor is CONFLICT.
    expect((await errorOf(as("joao").mutation(api.loans.transition, { loanId: pending, action: "claim_return" }))).code).toBe("CONFLICT");
    expect((await errorOf(t.mutation(api.loans.transition, { loanId: pending, action: "cancel" }))).code).toBe("UNAUTHENTICATED");
  });

  test("approve rejects overlap with an active loan", async () => {
    const { t, drill, joao, mei, as } = await world();
    await loanAt(t, drill, mei, "return_claimed", "2026-11-08", "2026-11-10");
    const pending = await loanAt(t, drill, joao, "pending", "2026-11-10", "2026-11-12");
    const err = await errorOf(as("ana").mutation(api.loans.transition, { loanId: pending, action: "approve" }));
    expect(err.code).toBe("CONFLICT");
    expect((await loanRow(t, pending))?.status).toBe("pending");
  });

  test("approve auto-declines overlapping pending requests and notifies them", async () => {
    const { t, ana, drill, joao, mei, as } = await world();
    const peri = await insertUser(t, "peri");
    const chosen = await loanAt(t, drill, joao, "pending", "2026-11-10", "2026-11-12");
    const overlapping = await loanAt(t, drill, mei, "pending", "2026-11-12", "2026-11-15");
    const alsoOverlapping = await loanAt(t, drill, peri, "pending", "2026-11-09", "2026-11-10");
    const later = await loanAt(t, drill, mei, "pending", "2026-11-13", "2026-11-14");

    await as("ana").mutation(api.loans.transition, { loanId: chosen, action: "approve" });

    expect(await loanRow(t, chosen)).toMatchObject({ status: "approved", decidedAt: expect.any(Number) });
    expect((await loanRow(t, overlapping))?.status).toBe("declined");
    expect((await loanRow(t, alsoOverlapping))?.status).toBe("declined");
    expect((await loanRow(t, later))?.status).toBe("pending");

    const rows = await deliveries(t);
    const declined = rows.filter((r) => r.type === "loan.declined");
    expect(declined.map((r) => [r.loanId, r.recipientId, r.actorId]).sort()).toEqual(
      [
        [overlapping, mei, undefined],
        [alsoOverlapping, peri, undefined],
      ].sort(),
    );
    expect(rows.filter((r) => r.type === "loan.approved")).toMatchObject([{ loanId: chosen, recipientId: joao, actorId: ana }]);
    expect(rows).toHaveLength(3);
  });

  test("second overlapping approval is CONFLICT", async () => {
    const { t, drill, joao, mei, as } = await world();
    const first = await loanAt(t, drill, joao, "pending", "2026-11-10", "2026-11-12");
    const second = await loanAt(t, drill, mei, "pending", "2026-11-11", "2026-11-13");
    await as("ana").mutation(api.loans.transition, { loanId: first, action: "approve" });
    // The second request was auto-declined, so approving it is a state conflict.
    expect((await errorOf(as("ana").mutation(api.loans.transition, { loanId: second, action: "approve" }))).code).toBe("CONFLICT");
    expect((await loanRow(t, second))?.status).toBe("declined");
  });

  test("dispute returns to approved and the loan counts as overdue again", async () => {
    const { t, drill, joao, as } = await world();
    const loanId = await loanAt(t, drill, joao, "approved", "2026-11-01", "2026-11-05");
    expect((await as("joao").query(api.loans.myRequests, {}))[0].overdue).toBe(true);

    await as("joao").mutation(api.loans.transition, { loanId, action: "claim_return" });
    expect(await loanRow(t, loanId)).toMatchObject({ status: "return_claimed", returnClaimedAt: expect.any(Number) });
    expect((await as("joao").query(api.loans.myRequests, {}))[0].overdue).toBe(false);

    await as("ana").mutation(api.loans.transition, { loanId, action: "dispute_return" });
    expect((await loanRow(t, loanId))?.status).toBe("approved");
    expect((await as("joao").query(api.loans.myRequests, {}))[0].overdue).toBe(true);
  });

  test("mark_returned works from approved and from return_claimed", async () => {
    const { t, drill, joao, as } = await world();
    const a = await loanAt(t, drill, joao, "approved", "2026-11-01", "2026-11-02");
    const b = await loanAt(t, drill, joao, "return_claimed", "2026-11-03", "2026-11-04");
    for (const loanId of [a, b]) {
      await as("ana").mutation(api.loans.transition, { loanId, action: "mark_returned" });
      expect(await loanRow(t, loanId)).toMatchObject({ status: "returned", returnedAt: expect.any(Number) });
    }
  });

  test("every transition enqueues exactly one event to the right recipient", async () => {
    const { t, ana, drill, joao, as } = await world();
    const cases: Array<{ from: LoanStatus; action: LoanAction; by: "ana" | "joao"; event: string; to: "ana" | "joao" }> = [
      { from: "pending", action: "approve", by: "ana", event: "loan.approved", to: "joao" },
      { from: "pending", action: "decline", by: "ana", event: "loan.declined", to: "joao" },
      { from: "pending", action: "cancel", by: "joao", event: "loan.cancelled", to: "ana" },
      { from: "approved", action: "claim_return", by: "joao", event: "loan.return_claimed", to: "ana" },
      { from: "return_claimed", action: "confirm_return", by: "ana", event: "loan.returned", to: "joao" },
      { from: "return_claimed", action: "dispute_return", by: "ana", event: "loan.return_disputed", to: "joao" },
      { from: "approved", action: "mark_returned", by: "ana", event: "loan.returned", to: "joao" },
    ];
    const ids = { ana, joao };
    for (const [i, c] of cases.entries()) {
      // Each case on its own dates so approvals never overlap.
      const day = String(10 + i * 2).padStart(2, "0");
      const loanId = await loanAt(t, drill, joao, c.from, `2026-11-${day}`, `2026-11-${day}`);
      const before = (await deliveries(t)).length;
      await as(c.by).mutation(api.loans.transition, { loanId, action: c.action });
      const rows = (await deliveries(t)).filter((r) => r.loanId === loanId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: c.event, recipientId: ids[c.to], actorId: ids[c.by] });
      expect((await deliveries(t)).length).toBe(before + 1);
    }
  });
});

describe("loan queries", () => {
  test("get hides counterpartEmail before approval and from non-party admins", async () => {
    const { t, drill, joao, as } = await world();
    const loanId = await as("joao").mutation(api.loans.request, { toolId: drill, startDate: "2026-11-10", endDate: "2026-11-12" });

    expect((await as("joao").query(api.loans.get, { loanId })).counterpartEmail).toBeNull();
    expect((await as("ana").query(api.loans.get, { loanId })).counterpartEmail).toBeNull();

    await as("ana").mutation(api.loans.transition, { loanId, action: "approve" });
    expect((await as("joao").query(api.loans.get, { loanId })).counterpartEmail).toBe("ana@example.test");
    expect((await as("ana").query(api.loans.get, { loanId })).counterpartEmail).toBe("joao@example.test");

    const adminView = await as("root").query(api.loans.get, { loanId });
    expect(adminView.counterpartEmail).toBeNull();
    expect(adminView.allowedActions).toEqual([]);
    expect((await errorOf(as("mei").query(api.loans.get, { loanId }))).code).toBe("FORBIDDEN");

    // A declined loan never reveals emails.
    const declined = await loanAt(t, drill, joao, "declined", "2026-11-20", "2026-11-21");
    expect((await as("joao").query(api.loans.get, { loanId: declined })).counterpartEmail).toBeNull();
  });

  test("get returns the row, its activity and a timeline", async () => {
    const { t, drill, as } = await world();
    const loanId = await as("joao").mutation(api.loans.request, { toolId: drill, startDate: "2026-11-10", endDate: "2026-11-12" });
    vi.setSystemTime(NOW + 60_000);
    await as("ana").mutation(api.loans.transition, { loanId, action: "approve" });
    await t.run((ctx) =>
      ctx.db.insert("automationEvents", { loanId, kind: "notification_sent", detail: "Borrower notified", at: NOW + 61_000 }),
    );

    const view = await as("joao").query(api.loans.get, { loanId });
    expect(view).toMatchObject({
      _id: loanId,
      status: "approved",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
      tool: { _id: drill, name: "Drill" },
      borrower: { name: "Joao" },
      lender: { name: "Ana", trustedLender: true },
      overdue: false,
      allowedActions: ["cancel", "claim_return"], // not picked up yet, so it can still be called off
      lastActivity: { kind: "notification_sent", at: NOW + 61_000 },
      activity: [{ kind: "notification_sent", detail: "Borrower notified", at: NOW + 61_000 }],
    });
    expect(view.timeline.map((e) => e.label)).toEqual(["Requested", "Approved"]);
    expect(view.timeline[1].at).toBeGreaterThanOrEqual(NOW + 60_000);
    // No ids of people, no emails other than the counterpart's.
    expect(JSON.stringify(view.borrower) + JSON.stringify(view.lender)).not.toContain("@");
  });

  test("incoming/myRequests return only the viewer's loans", async () => {
    const { t, ana, drill, joao, mei, as } = await world();
    const meiTool = await insertTool(t, mei, { name: "Tent", category: "camping" });
    const j1 = await loanAt(t, drill, joao, "pending");
    vi.setSystemTime(NOW + 1000);
    const m1 = await loanAt(t, drill, mei, "declined");
    vi.setSystemTime(NOW + 2000);
    const a1 = await loanAt(t, meiTool, ana, "approved");

    expect((await as("joao").query(api.loans.myRequests, {})).map((r) => r._id)).toEqual([j1]);
    expect((await as("joao").query(api.loans.incoming, {})).map((r) => r._id)).toEqual([]);
    expect((await as("ana").query(api.loans.incoming, {})).map((r) => r._id)).toEqual([m1, j1]); // newest first
    expect((await as("ana").query(api.loans.myRequests, {})).map((r) => r._id)).toEqual([a1]);
    const [incomingForMei] = await as("mei").query(api.loans.incoming, {});
    expect(incomingForMei).toMatchObject({ _id: a1, tool: { name: "Tent" }, borrower: { name: "Ana" }, allowedActions: ["revoke", "mark_returned"] });
    expect(Object.keys(incomingForMei).sort()).toEqual(
      ["_id", "allowedActions", "borrower", "endDate", "expired", "lastActivity", "lender", "overdue", "startDate", "status", "tool", "viewerRole"].sort(),
    );
    expect((await errorOf(t.query(api.loans.incoming, {}))).code).toBe("UNAUTHENTICATED");
  });

  test("adminList is admin-only and filters by status and overdue", async () => {
    const { t, drill, joao, mei, as } = await world();
    const overdue = await loanAt(t, drill, joao, "approved", "2026-11-01", "2026-11-05");
    const current = await loanAt(t, drill, mei, "approved", "2026-11-09", "2026-11-12");
    const pending = await loanAt(t, drill, mei, "pending", "2026-11-20", "2026-11-21");

    expect((await errorOf(as("ana").query(api.loans.adminList, {}))).code).toBe("FORBIDDEN");
    const asRoot = as("root");
    expect((await asRoot.query(api.loans.adminList, {})).map((r) => r._id).sort()).toEqual([overdue, current, pending].sort());
    expect((await asRoot.query(api.loans.adminList, { status: "pending" })).map((r) => r._id)).toEqual([pending]);
    expect((await asRoot.query(api.loans.adminList, { overdueOnly: true })).map((r) => r._id)).toEqual([overdue]);
    expect(await asRoot.query(api.loans.adminList, { status: "pending", overdueOnly: true })).toEqual([]);
  });
});

describe("tool removal and pending loans", () => {
  test("remove cancels pending loans and notifies borrowers", async () => {
    const { t, drill, joao, mei, as } = await world();
    const a = await loanAt(t, drill, joao, "pending", "2026-11-10", "2026-11-11");
    const b = await loanAt(t, drill, mei, "pending", "2026-11-12", "2026-11-13");
    const old = await loanAt(t, drill, mei, "returned", "2026-11-01", "2026-11-02");

    await as("ana").mutation(api.tools.remove, { toolId: drill });

    expect((await loanRow(t, a))?.status).toBe("cancelled");
    expect((await loanRow(t, b))?.status).toBe("cancelled");
    expect((await loanRow(t, old))?.status).toBe("returned");
    const rows = await deliveries(t);
    expect(rows.map((r) => [r.loanId, r.type, r.recipientId]).sort()).toEqual(
      [
        [a, "loan.cancelled", joao],
        [b, "loan.cancelled", mei],
      ].sort(),
    );
  });

  test("adminRemove cancels pending loans the same way and leaves the active loan", async () => {
    const { t, drill, joao, mei, as } = await world();
    const out = await loanAt(t, drill, joao, "approved", "2026-11-08", "2026-11-10");
    const waiting = await loanAt(t, drill, mei, "pending", "2026-11-20", "2026-11-21");

    await as("root").mutation(api.tools.adminRemove, { toolId: drill, reason: "Reported as unsafe" });

    expect((await loanRow(t, out))?.status).toBe("approved");
    expect((await loanRow(t, waiting))?.status).toBe("cancelled");
    expect((await deliveries(t)).map((r) => [r.loanId, r.type, r.recipientId])).toEqual([[waiting, "loan.cancelled", mei]]);
    // The lender can still finish the loan that is out.
    await as("ana").mutation(api.loans.transition, { loanId: out, action: "mark_returned" });
    expect((await loanRow(t, out))?.status).toBe("returned");
  });
});

describe("viewerRole on loan rows", () => {
  test("rows say which side the viewer is on, even when both parties share a name", async () => {
    const { t, ana, joao, drill, as, root } = await world();
    // Same display name on both sides: the server must still tell them apart.
    await t.run((ctx) => ctx.db.patch(joao, { name: "Ana" }));
    const loan = await loanAt(t, drill, joao, "approved");

    expect((await as("ana").query(api.loans.incoming, {}))[0].viewerRole).toBe("lender");
    expect((await as("joao").query(api.loans.myRequests, {}))[0].viewerRole).toBe("borrower");
    expect((await as("ana").query(api.loans.get, { loanId: loan })).viewerRole).toBe("lender");
    expect((await as("joao").query(api.loans.get, { loanId: loan })).viewerRole).toBe("borrower");
    // An admin who is not a party sees the loan with no side.
    expect((await as("root").query(api.loans.get, { loanId: loan })).viewerRole).toBeNull();
    expect((await as("root").query(api.loans.adminList, {}))[0].viewerRole).toBeNull();
    void ana;
    void root;
  });
});

describe("review fixes", () => {
  test("a stale pending request can't be approved and shows as expired", async () => {
    const { t, joao, drill, as } = await world();
    const stale = await loanAt(t, drill, joao, "pending", "2026-11-01", "2026-11-08");
    const err = await errorOf(as("ana").mutation(api.loans.transition, { loanId: stale, action: "approve" }));
    expect(err).toEqual({ code: "CONFLICT", message: "These dates have passed. Decline the request instead." });
    expect((await loanRow(t, stale))?.status).toBe("pending");
    const [row] = await as("ana").query(api.loans.incoming, {});
    expect(row).toMatchObject({ expired: true, allowedActions: ["decline"] });
  });

  test("the borrower can call off an approved loan before pickup; the lender is told", async () => {
    const { t, ana, joao, drill, as } = await world();
    const loan = await loanAt(t, drill, joao, "approved", "2026-11-12", "2026-11-14");
    await as("joao").mutation(api.loans.transition, { loanId: loan, action: "cancel" });
    expect((await loanRow(t, loan))?.status).toBe("cancelled");
    expect((await deliveries(t)).at(-1)).toMatchObject({ type: "loan.cancelled", recipientId: ana });
    // The tool is free again, so the owner can delete it.
    await as("ana").mutation(api.tools.remove, { toolId: drill });
  });

  test("the lender can revoke an approved loan before pickup; the borrower is told", async () => {
    const { t, joao, drill, as } = await world();
    const loan = await loanAt(t, drill, joao, "approved", "2026-11-12", "2026-11-14");
    await as("ana").mutation(api.loans.transition, { loanId: loan, action: "revoke" });
    expect(await loanRow(t, loan)).toMatchObject({ status: "cancelled" });
    expect((await loanRow(t, loan))?.decidedAt).toBeGreaterThanOrEqual(NOW);
    expect((await loanRow(t, loan))?.returnedAt).toBeUndefined();
    expect((await deliveries(t)).at(-1)).toMatchObject({ type: "loan.cancelled", recipientId: joao });
  });

  test("an approved loan that already started can't be called off", async () => {
    const { t, joao, drill, as } = await world();
    const loan = await loanAt(t, drill, joao, "approved", "2026-11-08", "2026-11-14");
    const err = await errorOf(as("ana").mutation(api.loans.transition, { loanId: loan, action: "revoke" }));
    expect(err).toEqual({ code: "CONFLICT", message: "This loan has already started, so it can only be returned now." });
  });

  test("a request for dates the tool is already lent out is rejected", async () => {
    const { t, joao, drill, as } = await world();
    await loanAt(t, drill, joao, "approved", "2026-11-10", "2026-11-14");
    const err = await errorOf(as("mei").mutation(api.loans.request, { toolId: drill, startDate: "2026-11-13", endDate: "2026-11-15" }));
    expect(err.code).toBe("CONFLICT");
    // Adjacent dates are fine.
    await as("mei").mutation(api.loans.request, { toolId: drill, startDate: "2026-11-15", endDate: "2026-11-16" });
  });

  test("a borrower can have at most 5 open requests", async () => {
    const { t, ana, as } = await world();
    for (let i = 0; i < 6; i++) await insertTool(t, ana, { name: `Tool ${i}` });
    const tools = await as("joao").query(api.tools.list, {});
    for (const tool of tools.slice(0, 5)) {
      await as("joao").mutation(api.loans.request, { toolId: tool._id, startDate: "2026-11-10", endDate: "2026-11-11" });
    }
    const err = await errorOf(
      as("joao").mutation(api.loans.request, { toolId: tools[5]._id, startDate: "2026-11-10", endDate: "2026-11-11" }),
    );
    expect(err).toEqual({ code: "CONFLICT", message: "You have 5 open requests. Wait for an answer or cancel one first." });
  });

  test("the counterpart email is hidden again 14 days after the return", async () => {
    const { t, joao, drill, as } = await world();
    const loan = await loanAt(t, drill, joao, "returned", "2026-10-01", "2026-10-03");
    await t.run((ctx) => ctx.db.patch(loan, { returnedAt: NOW - 13 * 86_400_000 }));
    expect((await as("joao").query(api.loans.get, { loanId: loan })).counterpartEmail).toBe("ana@example.test");
    await t.run((ctx) => ctx.db.patch(loan, { returnedAt: NOW - 15 * 86_400_000 }));
    expect((await as("joao").query(api.loans.get, { loanId: loan })).counterpartEmail).toBeNull();
  });

  test("anonymous callers are rejected by every loan function", async () => {
    const { t, joao, drill } = await world();
    const loan = await loanAt(t, drill, joao, "pending");
    const calls = [
      t.mutation(api.loans.request, { toolId: drill, startDate: "2026-11-10", endDate: "2026-11-11" }),
      t.mutation(api.loans.transition, { loanId: loan, action: "approve" }),
      t.query(api.loans.myRequests, {}),
      t.query(api.loans.incoming, {}),
      t.query(api.loans.get, { loanId: loan }),
      t.query(api.loans.adminList, {}),
    ];
    for (const call of calls) expect((await errorOf(call)).code).toBe("UNAUTHENTICATED");
  });

  test("a valid token without a users row is UNAUTHENTICATED", async () => {
    const { t, drill } = await world();
    const ghost = t.withIdentity(identity("ghost"));
    expect((await errorOf(ghost.query(api.loans.myRequests, {}))).code).toBe("UNAUTHENTICATED");
    expect((await errorOf(ghost.mutation(api.loans.request, { toolId: drill, startDate: "2026-11-10", endDate: "2026-11-11" }))).code).toBe(
      "UNAUTHENTICATED",
    );
  });
});
