import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { BACKOFF_MS } from "./lib/constants";
import { enqueueLoanEvent } from "./lib/outbox";
import { SIGNATURE_HEADER, verifyRequest } from "./lib/signature";
import { insertLoan, insertTool, insertUser, setup, type TestConvex } from "./lib/test.helpers";

const WEBHOOK_URL = "http://n8n:5678/webhook/lendloop-loan-events";
const SECRET = "convex-to-n8n-test-secret";

type FetchCall = { url: string; init: RequestInit };

/** Stubs fetch with a sequence of status codes (the last one repeats) and records every call. */
function stubFetch(statuses: number[]): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return new Response(status === 204 ? null : status < 300 ? '{"ok":true}' : "boom", { status });
  });
  return calls;
}

async function seedLoanEvent(t: TestConvex, actor = true) {
  const ana = await insertUser(t, "ana"); // lender
  const joao = await insertUser(t, "joao"); // borrower
  const toolId = await insertTool(t, ana, { name: "Tesoura de poda — jardim", description: "secret notes" });
  const loanId = await insertLoan(t, { toolId, borrowerId: joao, startDate: "2026-11-10", endDate: "2026-11-12", status: "approved" });
  await t.run((ctx) =>
    enqueueLoanEvent(ctx, { loanId, type: "loan.approved", recipientId: joao, actorId: actor ? ana : undefined }),
  );
  const [delivery] = await t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
  return { ana, joao, toolId, loanId, deliveryId: delivery._id as Id<"webhookDeliveries"> };
}

/** Runs only the first, immediate delivery attempt (retries stay scheduled). */
async function runFirstAttempt(t: TestConvex) {
  // Fires the next timer only: the immediate send. (convex-test pins transaction time a few ms
  // ahead of the clock, so a "0 ms" job may be due 1 ms from now.)
  vi.advanceTimersToNextTimer();
  await t.finishInProgressScheduledFunctions();
}

const deliveryRow = (t: TestConvex, id: Id<"webhookDeliveries">) => t.run((ctx) => ctx.db.get(id));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 9, 12, 0));
  vi.stubEnv("N8N_LOAN_EVENTS_WEBHOOK_URL", WEBHOOK_URL);
  vi.stubEnv("CONVEX_TO_N8N_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("outbox delivery", () => {
  test("enqueue inserts a pending delivery with a uuid eventId", async () => {
    stubFetch([200]);
    const t = setup();
    const { deliveryId, loanId, joao } = await seedLoanEvent(t);
    expect(await deliveryRow(t, deliveryId)).toMatchObject({
      loanId,
      type: "loan.approved",
      recipientId: joao,
      status: "pending",
      attempts: 0,
    });
    expect((await deliveryRow(t, deliveryId))?.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("payload contains only the fields of §8.1", async () => {
    stubFetch([200]);
    const t = setup();
    const { deliveryId, loanId } = await seedLoanEvent(t);
    const payload = await t.query(internal.delivery.buildPayload, { deliveryId });
    expect(payload).not.toBeNull();
    const p = payload!;
    expect(Object.keys(p).sort()).toEqual(["actor", "eventId", "loan", "occurredAt", "recipient", "tool", "type"]);
    expect(Object.keys(p.recipient).sort()).toEqual(["email", "name"]);
    expect(Object.keys(p.tool)).toEqual(["name"]);
    expect(Object.keys(p.loan).sort()).toEqual(["endDate", "id", "startDate", "status"]);
    expect(Object.keys(p.actor!)).toEqual(["name"]);
    expect(p).toMatchObject({
      type: "loan.approved",
      occurredAt: expect.stringMatching(/^2026-11-09T12:00:00\.\d{3}Z$/),
      recipient: { email: "joao@example.test", name: "Joao" },
      tool: { name: "Tesoura de poda — jardim" },
      loan: { id: loanId, startDate: "2026-11-10", endDate: "2026-11-12", status: "approved" },
      actor: { name: "Ana" },
    });
  });

  test("system events carry no actor (actor: null), so no user name can pose as the system", async () => {
    stubFetch([200]);
    const t = setup();
    const { deliveryId } = await seedLoanEvent(t, false);
    const payload = await t.query(internal.delivery.buildPayload, { deliveryId });
    expect(payload?.actor).toBeNull();
  });

  test("send signs the request", async () => {
    const calls = stubFetch([200]);
    const t = setup();
    await seedLoanEvent(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    const result = await verifyRequest({
      secret: SECRET,
      method: "POST",
      path: "/webhook/lendloop-loan-events",
      body: init.body as string,
      header: headers.get(SIGNATURE_HEADER),
      now: Date.now(),
    });
    expect(result).toEqual({ ok: true });
    expect(JSON.parse(init.body as string).tool.name).toBe("Tesoura de poda — jardim");
  });

  test("2xx marks sent", async () => {
    stubFetch([204]);
    const t = setup();
    const { deliveryId } = await seedLoanEvent(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await deliveryRow(t, deliveryId)).toMatchObject({ status: "sent", attempts: 0 });
  });

  test("failures retry with backoff then mark failed", async () => {
    const calls = stubFetch([500]);
    const t = setup();
    const { deliveryId, loanId } = await seedLoanEvent(t);
    const start = Date.now();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(BACKOFF_MS.length + 1); // initial try + one retry per delay = 6
    const row = await deliveryRow(t, deliveryId);
    expect(row).toMatchObject({ status: "failed", attempts: 6, lastError: "HTTP 500" });
    // Every listed delay was waited for.
    expect(Date.now() - start).toBeGreaterThanOrEqual(BACKOFF_MS.reduce((a, b) => a + b, 0));

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      loanId,
      kind: "delivery_failed",
      detail: "Could not reach the automation service",
    });
  });

  test("recovery after a failure", async () => {
    const calls = stubFetch([500, 200]);
    const t = setup();
    const { deliveryId } = await seedLoanEvent(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(2);
    expect(await deliveryRow(t, deliveryId)).toMatchObject({ status: "sent", attempts: 1 });
    expect(await t.run((ctx) => ctx.db.query("automationEvents").collect())).toHaveLength(0);
  });

  test("network errors count as failed attempts", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const t = setup();
    const { deliveryId } = await seedLoanEvent(t);
    await runFirstAttempt(t);
    expect(await deliveryRow(t, deliveryId)).toMatchObject({ status: "pending", attempts: 1, lastError: "fetch failed" });
  });

  test("missing configuration is a failed attempt without a request", async () => {
    const calls = stubFetch([200]);
    vi.stubEnv("CONVEX_TO_N8N_SECRET", "");
    const t = setup();
    const { deliveryId } = await seedLoanEvent(t);
    await runFirstAttempt(t);
    expect(calls).toHaveLength(0);
    const row = await deliveryRow(t, deliveryId);
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "not configured" });
    // The retry is due one backoff step later (tolerating convex-test's pinned transaction time).
    expect(row?.nextAttemptAt).toBeGreaterThanOrEqual(Date.now() + BACKOFF_MS[0]);
    expect(row?.nextAttemptAt).toBeLessThan(Date.now() + BACKOFF_MS[0] + 1000);
  });

  test("recordAttempt ignores deliveries that are no longer pending", async () => {
    stubFetch([200]);
    const t = setup();
    const { deliveryId } = await seedLoanEvent(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.mutation(internal.delivery.recordAttempt, { deliveryId, ok: false, error: "late duplicate" });
    expect(await deliveryRow(t, deliveryId)).toMatchObject({ status: "sent", attempts: 0 });
  });
});

describe("stuck delivery sweeper", () => {
  test("re-sends a delivery left pending (e.g. the backend restarted mid-send), and only that one", async () => {
    const t = setup();
    const { deliveryId, loanId, joao } = await seedLoanEvent(t);
    const calls = stubFetch([200]);
    // Simulate a crash: the scheduled send never ran, and 10 minutes have passed.
    await t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) await ctx.scheduler.cancel(job._id);
    });
    vi.setSystemTime(Date.now() + 10 * 60_000);
    // A delivery waiting for a scheduled retry in the future must be left alone.
    const waiting = await t.run((ctx) =>
      ctx.db.insert("webhookDeliveries", {
        eventId: "waiting",
        loanId,
        type: "loan.approved",
        recipientId: joao,
        status: "pending",
        attempts: 1,
        nextAttemptAt: Date.now() + 60_000,
        createdAt: Date.now() - 20 * 60_000,
      }),
    );

    expect(await t.mutation(internal.delivery.sweepStuck, {})).toEqual({ rescheduled: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(1);
    expect((await deliveryRow(t, deliveryId))?.status).toBe("sent");
    expect((await deliveryRow(t, waiting))?.status).toBe("pending");
  });

  test("leaves a fresh pending delivery alone", async () => {
    const t = setup();
    await seedLoanEvent(t);
    expect(await t.mutation(internal.delivery.sweepStuck, {})).toEqual({ rescheduled: 0 });
  });
});
