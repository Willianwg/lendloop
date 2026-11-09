import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { LoanStatus } from "./lib/constants";
import { SIGNATURE_HEADER, signRequest } from "./lib/signature";
import { enqueueLoanEvent } from "./lib/outbox";
import { errorOf, identity, insertLoan, insertTool, insertUser, setup, type TestConvex } from "./lib/test.helpers";

const SECRET = "n8n-to-convex-test-secret";
const NOW = Date.UTC(2026, 10, 9, 9, 0); // 2026-11-09 09:00 UTC, when the daily workflow runs
const TODAY = "2026-11-09";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("N8N_TO_CONVEX_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type SignOptions = { secret?: string; timestamp?: number; signedBody?: string; header?: string | null };

/** Sends a request the way n8n does: HMAC over `t.METHOD.path.rawBody`. */
async function signedFetch(t: TestConvex, method: "GET" | "POST", path: string, body?: unknown, o: SignOptions = {}) {
  const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const header =
    o.header !== undefined
      ? o.header
      : await signRequest({ secret: o.secret ?? SECRET, method, path, body: o.signedBody ?? raw, timestamp: o.timestamp });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (header !== null) headers[SIGNATURE_HEADER] = header;
  const res = await t.fetch(path, { method, headers, body: method === "GET" ? undefined : raw });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function world() {
  const t = setup();
  const ana = await insertUser(t, "ana");
  const joao = await insertUser(t, "joao");
  const root = await insertUser(t, "root", "admin");
  const drill = await insertTool(t, ana, { name: "Drill" });
  return { t, ana, joao, root, drill };
}

async function eventFor(t: TestConvex, loanId: Id<"loans">, recipientId: Id<"users">) {
  await t.run((ctx) => enqueueLoanEvent(ctx, { loanId, type: "loan.approved", recipientId }));
  const rows = await t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
  return rows[rows.length - 1].eventId;
}

const automationEvents = (t: TestConvex) => t.run((ctx) => ctx.db.query("automationEvents").collect());

const ROUTES: Array<{ method: "GET" | "POST"; path: string; body?: unknown }> = [
  { method: "POST", path: "/automation/notifications/claim", body: { eventId: "x" } },
  { method: "POST", path: "/automation/notifications/result", body: { eventId: "x", status: "sent", executionId: "1" } },
  { method: "GET", path: "/automation/overdue-loans" },
  { method: "POST", path: "/automation/reminders", body: { reminderKey: "a:2026-11-09", loanId: "a", status: "sent", executionId: "1" } },
  { method: "POST", path: "/automation/errors", body: { workflowName: "w", executionId: "1", message: "m" } },
];

describe("signed automation endpoints", () => {
  test.each(ROUTES)("unsigned, stale or tampered requests get 401: $method $path", async ({ method, path, body }) => {
    const { t } = await world();
    const unauthorized = { status: 401, json: { error: "unauthorized" } };
    expect(await signedFetch(t, method, path, body, { header: null })).toEqual(unauthorized);
    expect(await signedFetch(t, method, path, body, { header: "t=1,v1=nope" })).toEqual(unauthorized);
    expect(await signedFetch(t, method, path, body, { timestamp: NOW / 1000 - 301 })).toEqual(unauthorized);
    expect(await signedFetch(t, method, path, body, { secret: "wrong" })).toEqual(unauthorized);
    expect(await signedFetch(t, method, path, body, { signedBody: '{"tampered":true}' })).toEqual(unauthorized);
    // Without the secret configured, nothing is accepted.
    vi.stubEnv("N8N_TO_CONVEX_SECRET", "");
    expect(await signedFetch(t, method, path, body)).toEqual(unauthorized);
    expect(await automationEvents(t)).toHaveLength(0);
  });

  test("a signature for one route doesn't work on another", async () => {
    const { t } = await world();
    const body = JSON.stringify({ workflowName: "w", executionId: "1", message: "m" });
    const header = await signRequest({ secret: SECRET, method: "POST", path: "/automation/errors", body });
    const res = await t.fetch("/automation/reminders", { method: "POST", headers: { [SIGNATURE_HEADER]: header }, body });
    expect(res.status).toBe(401);
  });

  test("signed bodies that fail validation get 400", async () => {
    const { t } = await world();
    const invalid = { status: 400, json: { error: "invalid_body" } };
    expect(await signedFetch(t, "POST", "/automation/notifications/claim", "not json")).toEqual(invalid);
    expect(await signedFetch(t, "POST", "/automation/notifications/claim", { eventId: 42 })).toEqual(invalid);
    expect(await signedFetch(t, "POST", "/automation/notifications/result", { eventId: "x", status: "maybe", executionId: "1" })).toEqual(invalid);
    expect(await signedFetch(t, "POST", "/automation/errors", { workflowName: "w" })).toEqual(invalid);
  });

  test("claim lease", async () => {
    const { t, joao, drill } = await world();
    const loanId = await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-10", endDate: "2026-11-12", status: "approved" });
    const eventId = await eventFor(t, loanId, joao);
    const claim = () => signedFetch(t, "POST", "/automation/notifications/claim", { eventId });

    expect(await claim()).toEqual({ status: 200, json: { proceed: true } });
    // A concurrent duplicate: another run holds the lease and the outcome isn't known yet.
    expect(await claim()).toEqual({ status: 200, json: { proceed: false, reason: "in_progress" } });
    vi.setSystemTime(NOW + 4 * 60_000 + 59_000);
    expect((await claim()).json).toEqual({ proceed: false, reason: "in_progress" });
    vi.setSystemTime(NOW + 5 * 60_000 + 1000); // the lease of the crashed first run expired
    expect((await claim()).json).toEqual({ proceed: true });

    await signedFetch(t, "POST", "/automation/notifications/result", { eventId, status: "sent", executionId: "41" });
    vi.setSystemTime(NOW + 60 * 60_000);
    expect((await claim()).json).toEqual({ proceed: false, reason: "done" }); // already notified, forever

    expect(await signedFetch(t, "POST", "/automation/notifications/claim", { eventId: "unknown" })).toEqual({
      status: 404,
      json: { error: "not_found" },
    });
  });

  test("a failed result releases the lease, so the outbox retry sends the email again", async () => {
    const { t, joao, drill } = await world();
    const loanId = await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-10", endDate: "2026-11-12", status: "approved" });
    const eventId = await eventFor(t, loanId, joao);
    const claim = () => signedFetch(t, "POST", "/automation/notifications/claim", { eventId });
    const result = (status: "sent" | "failed", executionId: string) =>
      signedFetch(t, "POST", "/automation/notifications/result", { eventId, status, executionId });

    expect((await claim()).json).toEqual({ proceed: true });
    await result("failed", "1"); // SMTP was down
    vi.setSystemTime(NOW + 30_000); // Convex retries 30 s later
    expect((await claim()).json).toEqual({ proceed: true });
    await result("failed", "2"); // still down: the lease is released again
    vi.setSystemTime(NOW + 150_000);
    expect((await claim()).json).toEqual({ proceed: true });
    await result("sent", "3");
    expect((await claim()).json).toEqual({ proceed: false, reason: "done" });
    // One failure entry (the first) and one success entry.
    expect((await automationEvents(t)).map((e) => e.kind).sort()).toEqual(["notification_failed", "notification_sent"]);
  });

  test("result is idempotent", async () => {
    const { t, ana, joao, drill } = await world();
    const loanId = await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-10", endDate: "2026-11-12", status: "pending" });
    const toLender = await eventFor(t, loanId, ana);
    const toBorrower = await eventFor(t, loanId, joao);
    const result = (eventId: string, status: "sent" | "failed") =>
      signedFetch(t, "POST", "/automation/notifications/result", { eventId, status, executionId: "77" });

    expect(await result(toLender, "sent")).toEqual({ status: 200, json: { recorded: true } });
    expect(await result(toLender, "sent")).toEqual({ status: 200, json: { recorded: false } });
    expect(await result(toLender, "failed")).toEqual({ status: 200, json: { recorded: false } }); // never downgrade
    let events = await automationEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ loanId, kind: "notification_sent", detail: "Lender notified" });
    const delivery = await t.run((ctx) =>
      ctx.db.query("webhookDeliveries").withIndex("by_eventId", (q) => q.eq("eventId", toLender)).unique(),
    );
    expect(delivery).toMatchObject({ notifyStatus: "sent", processedAt: expect.any(Number) });

    // failed, then a later successful run upgrades it.
    expect((await result(toBorrower, "failed")).json).toEqual({ recorded: true });
    expect((await result(toBorrower, "failed")).json).toEqual({ recorded: false });
    expect((await result(toBorrower, "sent")).json).toEqual({ recorded: true });
    events = await automationEvents(t);
    expect(events.map((e) => [e.kind, e.detail])).toEqual([
      ["notification_sent", "Lender notified"],
      ["notification_failed", "Could not notify the borrower"],
      ["notification_sent", "Borrower notified"],
    ]);

    expect((await result("unknown", "sent")).status).toBe(404);
  });

  test("overdue-loans lists only approved past-due loans without today's sent reminder", async () => {
    const { t, joao, drill } = await world();
    const loan = (status: LoanStatus, endDate: string) =>
      insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-01", endDate, status });
    const overdue = await loan("approved", "2026-11-06");
    await loan("approved", TODAY); // due today: not overdue yet
    await loan("return_claimed", "2026-11-05"); // borrower says it's back: no reminders
    await loan("returned", "2026-11-05");
    const remindedToday = await loan("approved", "2026-11-07");
    const failedToday = await loan("approved", "2026-11-08");
    const remindedYesterday = await loan("approved", "2026-11-03");
    await t.run(async (ctx) => {
      const base = { recordedAt: NOW };
      await ctx.db.insert("reminders", { ...base, loanId: remindedToday, reminderKey: `${remindedToday}:${TODAY}`, status: "sent" });
      await ctx.db.insert("reminders", { ...base, loanId: failedToday, reminderKey: `${failedToday}:${TODAY}`, status: "failed" });
      await ctx.db.insert("reminders", { ...base, loanId: remindedYesterday, reminderKey: `${remindedYesterday}:2026-11-08`, status: "sent" });
    });

    const res = await signedFetch(t, "GET", "/automation/overdue-loans");
    expect(res.status).toBe(200);
    expect(res.json.today).toBe(TODAY);
    const ids = res.json.loans.map((l: { loanId: string }) => l.loanId).sort();
    expect(ids).toEqual([overdue, failedToday, remindedYesterday].sort());
    const first = res.json.loans.find((l: { loanId: string }) => l.loanId === overdue);
    expect(first).toEqual({
      loanId: overdue,
      reminderKey: `${overdue}:${TODAY}`,
      borrower: { email: "joao@example.test", name: "Joao" },
      tool: { name: "Drill" },
      endDate: "2026-11-06",
      daysOverdue: 3,
    });
  });

  test("reminders upsert", async () => {
    const { t, joao, drill } = await world();
    const a = await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-01", endDate: "2026-11-05", status: "approved" });
    const b = await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-01", endDate: "2026-11-05", status: "approved" });
    const c = await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-01", endDate: "2026-11-05", status: "approved" });
    const post = (loanId: Id<"loans">, status: "sent" | "failed", executionId = "9") =>
      signedFetch(t, "POST", "/automation/reminders", { reminderKey: `${loanId}:${TODAY}`, loanId, status, executionId });
    const reminders = () => t.run((ctx) => ctx.db.query("reminders").collect());
    const eventsOf = async (loanId: Id<"loans">) => (await automationEvents(t)).filter((e) => e.loanId === loanId);

    // Same key twice: one row, one event.
    expect(await post(a, "sent")).toEqual({ status: 200, json: { recorded: true } });
    expect(await post(a, "sent")).toEqual({ status: 200, json: { recorded: false } });
    expect((await reminders()).filter((r) => r.loanId === a)).toHaveLength(1);
    expect((await eventsOf(a)).map((e) => [e.kind, e.detail])).toEqual([["reminder_sent", "Reminder sent"]]);

    // failed then sent: upgraded in place, two events.
    expect((await post(b, "failed", "10")).json).toEqual({ recorded: true });
    expect((await post(b, "sent", "11")).json).toEqual({ recorded: true });
    const [rowB] = (await reminders()).filter((r) => r.loanId === b);
    expect(rowB).toMatchObject({ status: "sent", n8nExecutionId: "11", reminderKey: `${b}:${TODAY}` });
    expect((await eventsOf(b)).map((e) => e.kind)).toEqual(["reminder_failed", "reminder_sent"]);

    // sent then failed: unchanged.
    await post(c, "sent", "12");
    expect((await post(c, "failed", "13")).json).toEqual({ recorded: false });
    expect((await reminders()).filter((r) => r.loanId === c)).toMatchObject([{ status: "sent", n8nExecutionId: "12" }]);
    expect(await eventsOf(c)).toHaveLength(1);
  });

  test("reminderKey must match loanId and a date", async () => {
    const { t, joao, drill } = await world();
    const loanId = await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-01", endDate: "2026-11-05", status: "approved" });
    const other = await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-01", endDate: "2026-11-05", status: "approved" });
    const post = (reminderKey: string, id: string = loanId) =>
      signedFetch(t, "POST", "/automation/reminders", { reminderKey, loanId: id, status: "sent", executionId: "1" });
    const invalid = { status: 400, json: { error: "invalid_body" } };

    expect(await post(`${other}:${TODAY}`)).toEqual(invalid);
    expect(await post(`${loanId}:2026-13-01`)).toEqual(invalid);
    expect(await post(`${loanId}:${TODAY}:x`)).toEqual(invalid);
    expect(await post(`${loanId}`)).toEqual(invalid);
    expect(await post(`nope:${TODAY}`, "nope")).toEqual({ status: 404, json: { error: "not_found" } });
    expect(await t.run((ctx) => ctx.db.query("reminders").collect())).toHaveLength(0);
  });

  test("errors endpoint de-duplicates by executionId", async () => {
    const { t } = await world();
    const body = { workflowName: "LendLoop · Overdue reminders", nodeName: "Send reminder", executionId: "301", message: "SMTP timeout" };
    expect(await signedFetch(t, "POST", "/automation/errors", body)).toEqual({ status: 200, json: { recorded: true } });
    expect(await signedFetch(t, "POST", "/automation/errors", body)).toEqual({ status: 200, json: { recorded: false } });
    await signedFetch(t, "POST", "/automation/errors", { workflowName: "Notify", executionId: "302", message: "x".repeat(500) });

    const events = await automationEvents(t);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: "workflow_error",
      externalId: "301",
      detail: "LendLoop · Overdue reminders › Send reminder: SMTP timeout",
    });
    expect(events[0].loanId).toBeUndefined();
    expect(events[1].detail).toHaveLength(200);
    expect(events[1].detail.startsWith("Notify: xxx")).toBe(true);
  });

  test("error details never keep email addresses", async () => {
    const { t } = await world();
    await signedFetch(t, "POST", "/automation/errors", {
      workflowName: "Notify",
      executionId: "303",
      message: "550 mailbox joao.pereira+x@example.test unavailable",
    });
    const [event] = await automationEvents(t);
    expect(event.detail).toBe("Notify: 550 mailbox [email] unavailable");
  });

  test("adminHealth is admin-only", async () => {
    const { t, joao, drill } = await world();
    const loanId = await insertLoan(t, { toolId: drill, borrowerId: joao, startDate: "2026-11-10", endDate: "2026-11-12", status: "approved" });
    await t.run(async (ctx) => {
      await ctx.db.insert("webhookDeliveries", {
        eventId: "e-1",
        loanId,
        type: "loan.approved",
        recipientId: joao,
        status: "failed",
        attempts: 6,
        lastError: "HTTP 502",
        createdAt: NOW - 1000,
      });
      await ctx.db.insert("webhookDeliveries", {
        eventId: "e-2",
        loanId,
        type: "loan.requested",
        recipientId: joao,
        status: "sent",
        attempts: 0,
        createdAt: NOW,
      });
      await ctx.db.insert("automationEvents", { kind: "workflow_error", detail: "Notify: boom", externalId: "5", at: NOW });
      await ctx.db.insert("automationEvents", { loanId, kind: "reminder_sent", detail: "Reminder sent", at: NOW });
    });

    expect((await errorOf(t.withIdentity(identity("joao")).query(api.automation.adminHealth, {}))).code).toBe("FORBIDDEN");
    expect((await errorOf(t.query(api.automation.adminHealth, {}))).code).toBe("UNAUTHENTICATED");

    const health = await t.withIdentity(identity("root")).query(api.automation.adminHealth, {});
    expect(health).toEqual({
      failedDeliveries: [{ eventId: "e-1", loanId, type: "loan.approved", attempts: 6, lastError: "HTTP 502", at: NOW - 1000 }],
      workflowErrors: [{ detail: "Notify: boom", at: NOW }],
    });
  });
});
