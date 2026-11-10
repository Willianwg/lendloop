// Sends one signed loan event to the n8n webhook, the way Convex's outbox does.
// For testing the Notify workflow without the app.
//
//   npx tsx scripts/dev/send-loan-event.ts [--type loan.approved] [--name "João"] [--tool "<b>Drill</b> & Saw"]
//        [--event-id <uuid>] [--to someone@example.com] [--bad-signature] [--url http://localhost:5678/webhook/lendloop-loan-events]
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { SIGNATURE_HEADER, signRequest } from "../../convex/lib/signature";
import { envValue } from "./env";

const { values: a } = parseArgs({
  options: {
    type: { type: "string", default: "loan.approved" },
    name: { type: "string", default: "João Silva" },
    actor: { type: "string", default: "Maria Souza" },
    tool: { type: "string", default: "Tesoura de poda — jardim" },
    to: { type: "string", default: "borrower@example.com" },
    "event-id": { type: "string" },
    "bad-signature": { type: "boolean", default: false },
    url: { type: "string", default: `http://localhost:${process.env.N8N_PORT ?? 5678}/webhook/lendloop-loan-events` },
  },
});

async function main() {
  const payload = {
    eventId: a["event-id"] ?? randomUUID(),
    type: a.type,
    occurredAt: new Date().toISOString(),
    recipient: { email: a.to, name: a.name },
    tool: { name: a.tool },
    loan: { id: "k57demoloan000000000000000000001", startDate: "2026-11-12", endDate: "2026-11-15", status: "approved" },
    actor: { name: a.actor },
  };
  const body = JSON.stringify(payload);
  const url = new URL(a.url!);
  const secret = a["bad-signature"] ? "not-the-real-secret" : envValue("CONVEX_TO_N8N_SECRET");
  const signature = await signRequest({ secret, method: "POST", path: url.pathname, body });

  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signature }, body });
  console.log(JSON.stringify({ eventId: payload.eventId, status: res.status, body: await res.text() }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
