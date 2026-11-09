// End-to-end smoke test of the automation pipeline, against the running compose stack:
//
//   Convex outbox → signed webhook → n8n → Mailpit → signed write-backs → Convex
//
//   npm run smoke            (needs scripts/setup.sh to have run; seeds if needed)
//   npm run smoke -- --keep  (keep this run's fixture and emails for inspection)
//
// Ports and secrets come from .env and .env.local, so any port offset works. Safe to re-run:
// each run creates its own fixture (convex/devtools.ts) — a fresh loan request and a fresh
// overdue loan, owned by the seeded neighbors, whose events go through the real outbox — and
// deletes it, with its emails, when every check passed. A failed run keeps it for inspection;
// the next run deletes it first. The demo data and the rest of the Mailpit inbox are untouched.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SIGNATURE_HEADER, signRequest } from "../convex/lib/signature";

const ROOT = join(__dirname, "..");
const KEEP = process.argv.includes("--keep");
const TIMEOUT_MS = 30_000;
const CLI_TIMEOUT_MS = 180_000;
const OVERDUE_CMD = ["compose", "run", "--rm", "--no-deps", "n8n", "execute", "--id=LendLoopOverdue01"];

// ---- configuration ------------------------------------------------------------------------

function readEnvFile(name: string): Record<string, string> {
  let text = "";
  try {
    text = readFileSync(join(ROOT, name), "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const env = (key: string, fallback?: string): string => {
  const value = process.env[key] || fileEnv[key] || fallback;
  if (!value) throw new Error(`${key} is not set: run scripts/setup.sh first`);
  return value;
};

const cfg = {
  convexUrl: env("CONVEX_SELF_HOSTED_URL").replace(/\/$/, ""),
  adminKey: env("CONVEX_SELF_HOSTED_ADMIN_KEY"),
  siteUrl: `http://127.0.0.1:${env("CONVEX_SITE_PORT", "3211")}`,
  mailpitUrl: `http://127.0.0.1:${env("MAILPIT_UI_PORT", "8025")}`,
  n8nPort: env("N8N_PORT", "5678"),
  n8nToConvexSecret: env("N8N_TO_CONVEX_SECRET"),
};

// ---- small helpers ------------------------------------------------------------------------

class CheckFailed extends Error {}
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new CheckFailed(message);
}

/**
 * Calls `fn` until it returns something other than undefined, or fails with `what` after `ms`.
 * `explain` adds the state that was observed (e.g. the outbox row's last error) to the failure.
 */
async function poll<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  explain?: () => Promise<string>,
  ms = TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + ms;
  let delay = 250;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      const why = explain ? `; ${await explain().catch((e) => String(e))}` : "";
      throw new CheckFailed(`timed out after ${ms / 1000} s waiting for ${what}${why}`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 2_000);
  }
}

function run(cmd: string, args: string[], timeout = CLI_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: ROOT, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      // Only the tail: the full output can include execution data.
      const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-12).join("\n");
      reject(new CheckFailed(`\`${cmd} ${args.join(" ")}\` failed (${err.message.split("\n")[0]}):\n${tail}`));
    });
  });
}

/** Runs a Convex function as the deployment admin (what `npx convex run` does), internal ones included. */
async function convex<T>(path: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${cfg.convexUrl}/api/function`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Convex ${cfg.adminKey}` },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const body = (await res.json().catch(() => null)) as { status?: string; value?: T; errorMessage?: string } | null;
  if (!body || body.status !== "success") {
    throw new CheckFailed(`${path} failed: ${body?.errorMessage ?? `HTTP ${res.status}`}`);
  }
  return body.value as T;
}

/** A request to a Convex automation route, signed the way n8n signs it. */
async function signedFetch(method: "GET" | "POST", path: string, body = "", secret = cfg.n8nToConvexSecret) {
  const signature = await signRequest({ secret, method, path, body });
  const res = await fetch(`${cfg.siteUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: signature },
    body: method === "GET" ? undefined : body,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null, signature };
}

type MailSummary = { ID: string; Subject: string; To: Array<{ Address: string }> };
type Mail = { ID: string; Subject: string; HTML: string; Text: string; To: Array<{ Address: string }> };

const mailpit = {
  async search(query: string): Promise<MailSummary[]> {
    const res = await fetch(`${cfg.mailpitUrl}/api/v1/search?limit=200&query=${encodeURIComponent(query)}`);
    assert(res.ok, `Mailpit search answered HTTP ${res.status}`);
    return ((await res.json()) as { messages: MailSummary[] }).messages;
  },
  async get(id: string): Promise<Mail> {
    const res = await fetch(`${cfg.mailpitUrl}/api/v1/message/${id}`);
    assert(res.ok, `Mailpit message ${id} answered HTTP ${res.status}`);
    return (await res.json()) as Mail;
  },
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await fetch(`${cfg.mailpitUrl}/api/v1/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: ids }),
    });
  },
  /** Emails to `to` whose subject starts with `subject` and whose loan link points at `loanId`. */
  async forLoan(to: string, subject: string, loanId: string): Promise<Mail[]> {
    const found: Mail[] = [];
    for (const m of await mailpit.search(`to:"${to}"`)) {
      if (!m.Subject.startsWith(subject)) continue;
      const full = await mailpit.get(m.ID);
      if (full.HTML.includes(`/loans/${loanId}`) || full.Text.includes(`/loans/${loanId}`)) found.push(full);
    }
    return found;
  },
};

// ---- Convex shapes (convex/devtools.ts) ----------------------------------------------------

type Delivery = {
  eventId: string;
  type: string;
  status: string;
  notifyStatus: string | null;
  viaN8n: boolean;
  attempts: number;
  lastError: string | null;
  recipientName: string | null;
  actorName: string | null;
};
type LoanState = {
  loanId: string;
  deliveries: Delivery[];
  reminders: Array<{ reminderKey: string; status: string; n8nExecutionId: string | null }>;
  events: Array<{ kind: string; detail: string }>;
};
type Fixture = {
  purged: number;
  today: string;
  requestedLoanId: string;
  overdueLoanId: string;
  lender: { name: string; email: string };
  borrower: { name: string; email: string };
};

const loanState = async (loanId: string) =>
  (await convex<LoanState[]>("devtools:loanAutomationState", { loanIds: [loanId] }))[0];
const delivered = (d: Delivery) => d.status === "sent" && d.notifyStatus === "sent";
/** For timeouts: what the loan's outbox rows look like now. */
const outbox = (loanId: string) => async () =>
  `outbox: ${(await loanState(loanId)).deliveries.map(describe).join("; ") || "no rows"}`;
function describe(d: Delivery): string {
  return `${d.type} → ${d.recipientName}: ${d.status}/${d.notifyStatus ?? "-"}${d.lastError ? ` (${d.lastError}, ${d.attempts} failed)` : ""}`;
}

// ---- the checks -----------------------------------------------------------------------------

const ESCAPED_TOOL = "&lt;b&gt;Drill&lt;/b&gt; &amp; Saw";
const ctx: {
  fixture?: Fixture;
  reminderBody?: string;
  mailIds: string[];
} = { mailIds: [] };

const checks: Array<[string, () => Promise<string>]> = [
  [
    "seed:dev, then a fresh fixture whose events go through the outbox",
    async () => {
      const out = await run("npx", ["convex", "run", "seed:dev"]);
      const base = /already seeded/.test(out) ? "already seeded" : "seeded now";
      ctx.fixture = await convex<Fixture>("devtools:createSmokeFixture");
      // The seed's own events (pending and approved loans) must have been delivered too.
      const seed = await poll("the seed's notifications", async () => {
        const rows = await convex<Delivery[]>("devtools:seedDeliveries");
        const stuck = rows.filter((d) => !delivered(d));
        if (stuck.some((d) => d.status === "failed")) {
          throw new CheckFailed(`seed delivery failed: ${stuck.map(describe).join("; ")}`);
        }
        return stuck.length === 0 ? rows : undefined;
      }, async () => {
        const stuck = (await convex<Delivery[]>("devtools:seedDeliveries")).filter((d) => !delivered(d));
        return `not delivered: ${stuck.map(describe).join("; ")}`;
      });
      const live = seed.filter((d) => d.viaN8n).length;
      assert(live > 0, "no seed notification went through n8n: did the seed enqueue its events?");
      const purged = ctx.fixture.purged ? `; ${ctx.fixture.purged} leftover fixture tools deleted` : "";
      return `base ${base}; ${live} seed notifications delivered through n8n (+${seed.length - live} history rows)${purged}`;
    },
  ],
  [
    "loan.requested email reaches the lender, with the HTML tool name escaped",
    async () => {
      const f = ctx.fixture!;
      const [mail] = await poll("the loan.requested email in Mailpit", async () => {
        const found = await mailpit.forLoan(f.lender.email, "New request to borrow your", f.requestedLoanId);
        return found.length ? found : undefined;
      }, outbox(f.requestedLoanId));
      ctx.mailIds.push(mail.ID);
      assert(mail.HTML.includes(ESCAPED_TOOL), `HTML does not contain ${ESCAPED_TOOL}`);
      assert(!mail.HTML.includes("<b>Drill</b>"), "HTML contains the raw <b> tag: markup was injected");
      assert(mail.Subject === "New request to borrow your <b>Drill</b> & Saw", `unexpected subject: ${mail.Subject}`);
      const state = await poll("notifyStatus sent on the loan.requested delivery", async () => {
        const s = await loanState(f.requestedLoanId);
        return s.deliveries.length === 1 && delivered(s.deliveries[0]) ? s : undefined;
      }, outbox(f.requestedLoanId));
      assert(state.events.some((e) => e.kind === "notification_sent"), "no notification_sent activity row");
      return `"${mail.Subject}" to ${f.lender.name}; HTML has ${ESCAPED_TOOL}; write-back recorded`;
    },
  ],
  [
    "Overdue workflow reminds the overdue borrower and records one sent reminder",
    async () => {
      const f = ctx.fixture!;
      await run("docker", OVERDUE_CMD);
      const [mail] = await poll("the reminder email in Mailpit", async () => {
        const found = await mailpit.forLoan(f.borrower.email, "Reminder: please return", f.overdueLoanId);
        return found.length ? found : undefined;
      }, async () => `reminders: ${JSON.stringify((await loanState(f.overdueLoanId)).reminders)}`);
      ctx.mailIds.push(mail.ID);
      const key = `${f.overdueLoanId}:${f.today}`;
      const state = await poll(`a sent reminder row for ${key}`, async () => {
        const s = await loanState(f.overdueLoanId);
        return s.reminders.some((r) => r.status === "sent") ? s : undefined;
      }, async () => `reminders: ${JSON.stringify((await loanState(f.overdueLoanId)).reminders)}`);
      assert(state.reminders.length === 1, `expected 1 reminder row, found ${state.reminders.length}`);
      const [reminder] = state.reminders;
      assert(reminder.reminderKey === key, `reminderKey is ${reminder.reminderKey}, expected ${key}`);
      assert(reminder.n8nExecutionId, "reminder has no n8n execution id");
      ctx.reminderBody = JSON.stringify({ reminderKey: key, loanId: f.overdueLoanId, status: "sent", executionId: reminder.n8nExecutionId });
      return `"${mail.Subject}" to ${f.borrower.name}; reminders has 1 sent row ${key}`;
    },
  ],
  [
    "replaying the signed reminder write-back records nothing",
    async () => {
      const f = ctx.fixture!;
      const res = await signedFetch("POST", "/automation/reminders", ctx.reminderBody!);
      assert(res.status === 200, `expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
      assert(res.json?.recorded === false, `expected {"recorded":false}, got ${JSON.stringify(res.json)}`);
      const s = await loanState(f.overdueLoanId);
      assert(s.reminders.length === 1 && s.reminders[0].status === "sent", `reminders changed: ${JSON.stringify(s.reminders)}`);
      const sentEvents = s.events.filter((e) => e.kind === "reminder_sent").length;
      assert(sentEvents === 1, `expected 1 reminder_sent activity row, found ${sentEvents}`);
      return `200 {"recorded":false}; still 1 reminder row and 1 reminder_sent activity`;
    },
  ],
  [
    "a bad signature is rejected with 401",
    async () => {
      const f = ctx.fixture!;
      const wrongSecret = await signedFetch("POST", "/automation/reminders", ctx.reminderBody!, "not-the-real-secret");
      assert(wrongSecret.status === 401, `wrong secret: expected 401, got ${wrongSecret.status}`);
      // A valid signature over a different body: flipping the status must not get through either.
      const signature = (await signedFetch("GET", "/automation/overdue-loans")).signature;
      const tampered = await fetch(`${cfg.siteUrl}/automation/reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: signature },
        body: ctx.reminderBody!.replace('"sent"', '"failed"'),
      });
      assert(tampered.status === 401, `signature for another request: expected 401, got ${tampered.status}`);
      const s = await loanState(f.overdueLoanId);
      assert(s.reminders.length === 1 && s.reminders[0].status === "sent", "a rejected request changed the reminder");
      return "wrong secret → 401; signature from another request → 401; reminder unchanged";
    },
  ],
  [
    "a second Overdue run sends no new reminder for that loan",
    async () => {
      const f = ctx.fixture!;
      const listed = await signedFetch("GET", "/automation/overdue-loans");
      assert(listed.status === 200, `GET /automation/overdue-loans: HTTP ${listed.status}`);
      const loans = (listed.json?.loans ?? []) as Array<{ loanId: string }>;
      assert(!loans.some((l) => l.loanId === f.overdueLoanId), "the reminded loan is still listed as due today");
      await run("docker", OVERDUE_CMD);
      // `n8n execute` returns once the workflow finished, so any email it sent is already in Mailpit.
      const mails = await mailpit.forLoan(f.borrower.email, "Reminder: please return", f.overdueLoanId);
      assert(mails.length === 1, `expected 1 reminder email for the loan, found ${mails.length}`);
      const s = await loanState(f.overdueLoanId);
      const sentEvents = s.events.filter((e) => e.kind === "reminder_sent").length;
      assert(s.reminders.length === 1 && sentEvents === 1, `reminders: ${s.reminders.length} rows, ${sentEvents} reminder_sent`);
      return "loan no longer listed as due; still 1 reminder email and 1 reminder row";
    },
  ],
  [
    "João's notifications round-trip with valid signatures (UTF-8 names)",
    async () => {
      const f = ctx.fixture!;
      const name = f.borrower.name;
      assert(name === "João Pereira", `expected the seeded borrower João Pereira, got ${name}`);
      const involvesJoao = (d: Delivery) => d.recipientName === name || d.actorName === name;
      const rows = await poll(`every outbox row naming ${name} to be delivered`, async () => {
        const fixture = await convex<LoanState[]>("devtools:loanAutomationState", { loanIds: [f.requestedLoanId, f.overdueLoanId] });
        const seed = await convex<Delivery[]>("devtools:seedDeliveries");
        const all = [...fixture.flatMap((s) => s.deliveries), ...seed].filter(involvesJoao);
        return all.every(delivered) ? all : undefined;
      }, async () => `fixture ${await outbox(f.requestedLoanId)()} | ${await outbox(f.overdueLoanId)()}`);
      // The email shows the name and tool exactly as stored: the signed bytes were the sent bytes.
      const [approved] = await poll("the loan.approved email to João", async () => {
        const found = await mailpit.forLoan(f.borrower.email, "Approved: you can borrow", f.overdueLoanId);
        return found.length ? found : undefined;
      }, outbox(f.overdueLoanId));
      ctx.mailIds.push(approved.ID);
      assert(approved.Subject === "Approved: you can borrow Tesoura de poda — jardim", `unexpected subject: ${approved.Subject}`);
      assert(approved.HTML.includes(`Hi ${name},`) && approved.Text.includes(`Hi ${name},`), "greeting does not show João Pereira intact");
      const live = rows.filter((d) => d.viaN8n);
      const toHim = live.filter((d) => d.recipientName === name).length;
      const byHim = live.filter((d) => d.actorName === name).length;
      assert(toHim > 0 && byHim > 0, `expected events both to and by ${name} through n8n (to: ${toHim}, by: ${byHim})`);
      return `${live.length} events naming ${name} (${toHim} to him, ${byHim} by him) verified by n8n and written back; "${approved.Subject}"`;
    },
  ],
];

async function main() {
  const started = Date.now();
  console.log(`LendLoop e2e smoke · convex ${cfg.convexUrl} · n8n :${cfg.n8nPort} · mailpit ${cfg.mailpitUrl}\n`);
  for (const [i, [title, check]] of checks.entries()) {
    try {
      const detail = await check();
      console.log(`✓ ${i + 1}. ${title}\n     ${detail}`);
    } catch (e) {
      console.log(`✗ ${i + 1}. ${title}\n     ${e instanceof Error ? e.message : String(e)}`);
      if (ctx.fixture) {
        console.log(
          `\nFixture kept for inspection (loans ${ctx.fixture.requestedLoanId}, ${ctx.fixture.overdueLoanId}); the next run deletes it.`,
        );
      }
      if (!(e instanceof CheckFailed) && e instanceof Error && e.stack) console.log(e.stack);
      process.exit(1);
    }
  }
  if (!KEEP) {
    await convex("devtools:deleteSmokeFixture");
    await mailpit.delete(ctx.mailIds);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nAll ${checks.length} checks passed in ${seconds} s.${KEEP ? " Fixture kept (--keep)." : " Fixture and its emails deleted."}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
