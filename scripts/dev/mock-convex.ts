// A stand-in for the Convex automation endpoints (plan Task 7), for testing the n8n workflows
// on their own. It verifies every request with the real convex/lib/signature.ts and keeps
// state in memory. Not used by the app.
//
//   npx tsx scripts/dev/mock-convex.ts            # listens on 0.0.0.0:3499 (MOCK_PORT to change)
//
// Point n8n at it with a compose override file kept outside the repo, e.g. /tmp/compose.mock.yml:
//
//   services:
//     n8n:
//       environment: [LENDLOOP_CONVEX_SITE_URL=http://host.docker.internal:3499]
//       extra_hosts: ["host.docker.internal:host-gateway"]
//
//   docker compose -f docker-compose.yml -f /tmp/compose.mock.yml up -d n8n   # `up -d n8n` again to undo
//
// Contract routes (signed with N8N_TO_CONVEX_SECRET):
//   POST /automation/notifications/claim   { eventId }                               -> { proceed }
//   POST /automation/notifications/result  { eventId, status, executionId }          -> { recorded }
//   GET  /automation/overdue-loans                                                   -> { today, loans }
//   POST /automation/reminders             { reminderKey, loanId, status, executionId } -> { recorded }
//   POST /automation/errors                { workflowName, nodeName?, executionId, message } -> { recorded }
// Test controls (unsigned, dev only):
//   GET  /_mock/state     everything recorded so far, plus a call log
//   POST /_mock/reset     clear state
//   POST /_mock/overdue   { loans: [...] }  the loans GET /automation/overdue-loans returns
// An eventId starting with "unknown-" is treated as an unknown event (404), to make n8n fail.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SIGNATURE_HEADER, verifyRequest } from "../../convex/lib/signature";
import { envValue } from "./env";

const PORT = Number(process.env.MOCK_PORT ?? 3499);
const LEASE_MS = 5 * 60 * 1000;
const secret = envValue("N8N_TO_CONVEX_SECRET");

type Status = "sent" | "failed";
type OverdueLoan = { loanId: string; borrower: { email: string; name: string }; tool: { name: string }; endDate: string; daysOverdue: number };

const state = {
  claims: {} as Record<string, { claimedAt: number; notifyStatus?: Status }>,
  results: [] as Array<{ eventId: string; status: Status; executionId: string }>,
  reminders: {} as Record<string, { loanId: string; status: Status; executionId: string }>,
  errors: {} as Record<string, { workflowName: string; nodeName?: string; message: string }>,
  overdue: [] as OverdueLoan[],
  calls: [] as Array<{ method: string; path: string; status: number; note?: string }>,
};

const todayUtc = () => new Date().toISOString().slice(0, 10);
const isStatus = (s: unknown): s is Status => s === "sent" || s === "failed";
const isString = (s: unknown): s is string => typeof s === "string" && s.length > 0;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Route handlers return [status, body]. `b` is the parsed JSON body ({} for GET).
type Handler = (b: Record<string, unknown>) => [number, unknown];

const routes: Record<string, Handler> = {
  "POST /automation/notifications/claim": (b) => {
    if (!isString(b.eventId)) return [400, { error: "invalid_body" }];
    if (b.eventId.startsWith("unknown-")) return [404, { error: "not_found" }];
    const now = Date.now();
    const claim = state.claims[b.eventId];
    if (claim?.notifyStatus === "sent") return [200, { proceed: false }];
    if (claim && now - claim.claimedAt < LEASE_MS) return [200, { proceed: false }];
    state.claims[b.eventId] = { ...claim, claimedAt: now };
    return [200, { proceed: true }];
  },

  "POST /automation/notifications/result": (b) => {
    if (!isString(b.eventId) || !isStatus(b.status) || !isString(b.executionId)) return [400, { error: "invalid_body" }];
    const claim = state.claims[b.eventId];
    if (!claim) return [404, { error: "not_found" }];
    // Idempotent: same status again, or failed after sent, records nothing.
    if (claim.notifyStatus === b.status || (claim.notifyStatus === "sent" && b.status === "failed")) {
      return [200, { recorded: false }];
    }
    claim.notifyStatus = b.status;
    state.results.push({ eventId: b.eventId, status: b.status, executionId: b.executionId });
    return [200, { recorded: true }];
  },

  "GET /automation/overdue-loans": () => {
    const today = todayUtc();
    const loans = state.overdue
      .map((l) => ({ ...l, reminderKey: `${l.loanId}:${today}` }))
      .filter((l) => state.reminders[l.reminderKey]?.status !== "sent");
    return [200, { today, loans }];
  },

  "POST /automation/reminders": (b) => {
    if (!isString(b.reminderKey) || !isString(b.loanId) || !isStatus(b.status) || !isString(b.executionId)) {
      return [400, { error: "invalid_body" }];
    }
    const [loanId, date, extra] = b.reminderKey.split(":");
    if (loanId !== b.loanId || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || extra !== undefined) {
      return [400, { error: "invalid_body" }];
    }
    const existing = state.reminders[b.reminderKey];
    // Upsert: failed can be upgraded to sent, never the reverse; repeats record nothing.
    if (existing && (existing.status === "sent" || existing.status === b.status)) return [200, { recorded: false }];
    state.reminders[b.reminderKey] = { loanId: b.loanId, status: b.status, executionId: b.executionId };
    return [200, { recorded: true }];
  },

  "POST /automation/errors": (b) => {
    if (!isString(b.workflowName) || !isString(b.executionId) || !isString(b.message)) return [400, { error: "invalid_body" }];
    if (b.nodeName !== undefined && typeof b.nodeName !== "string") return [400, { error: "invalid_body" }];
    if (state.errors[b.executionId]) return [200, { recorded: false }];
    state.errors[b.executionId] = { workflowName: b.workflowName, nodeName: b.nodeName as string | undefined, message: b.message };
    return [200, { recorded: true }];
  },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://mock");
  const method = req.method ?? "GET";
  const raw = await readBody(req);
  const log = (status: number, note?: string) => {
    state.calls.push({ method, path: url.pathname, status, note });
    console.log(JSON.stringify({ event: "mock_call", method, path: url.pathname, status, note }));
  };

  // Test controls.
  if (url.pathname === "/_mock/state") return send(res, 200, state);
  if (url.pathname === "/_mock/reset" && method === "POST") {
    Object.assign(state, { claims: {}, results: [], reminders: {}, errors: {}, overdue: [], calls: [] });
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/_mock/overdue" && method === "POST") {
    state.overdue = (JSON.parse(raw) as { loans: OverdueLoan[] }).loans;
    return send(res, 200, { ok: true, count: state.overdue.length });
  }

  const handler = routes[`${method} ${url.pathname}`];
  if (!handler) {
    log(404);
    return send(res, 404, { error: "not_found" });
  }

  const verdict = await verifyRequest({
    secret,
    method,
    path: url.pathname,
    body: raw,
    header: (req.headers[SIGNATURE_HEADER.toLowerCase()] as string | undefined) ?? null,
  });
  if (!verdict.ok) {
    log(401, verdict.reason);
    return send(res, 401, { error: "unauthorized" });
  }

  let body: Record<string, unknown> = {};
  if (method !== "GET") {
    try {
      body = JSON.parse(raw);
    } catch {
      log(400, "json");
      return send(res, 400, { error: "invalid_body" });
    }
  }
  const [status, out] = handler(body);
  log(status, JSON.stringify(out));
  send(res, status, out);
});

server.listen(PORT, "0.0.0.0", () => console.log(`mock-convex listening on :${PORT}`));
