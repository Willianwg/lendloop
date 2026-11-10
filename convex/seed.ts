// Demo data for a local stack: `npx convex run seed:dev` (internal, so only the admin key can run it).
//
// Three neighbors, ten tools across every category, and loans in every status, dated around
// today so the overdue loan is really overdue. The current event of each pending and approved
// loan goes through the real outbox (enqueueLoanEvent), so seeding sends real emails through
// n8n to Mailpit. Earlier steps of each loan's history are inserted as already-delivered outbox
// rows: the loan timeline is read from the outbox, and history should not email anyone again.
//
//   npx convex run seed:dev                                   base data (skipped if present)
//   npx convex run seed:dev '{"attachEmail":"you@example.com"}'   also gives your account some loans
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Category, Condition, EventType, LoanStatus } from "./lib/constants";
import { addDays, todayUtc } from "./lib/dates";
import { fail } from "./lib/errors";
import { TRANSITIONS } from "./lib/loans";
import { enqueueLoanEvent } from "./lib/outbox";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const SEED_USERS = [
  { key: "ana", clerkId: "seed|ana", name: "Ana Souza", email: "ana.souza@example.test", trustedLender: true },
  { key: "joao", clerkId: "seed|joao", name: "João Pereira", email: "joao.pereira@example.test", trustedLender: false },
  { key: "mei", clerkId: "seed|mei", name: "Mei Chen", email: "mei.chen@example.test", trustedLender: false },
] as const;
type UserKey = (typeof SEED_USERS)[number]["key"];

type ToolSpec = { key: string; owner: UserKey; name: string; category: Category; condition: Condition; description: string };

const SEED_TOOLS: readonly ToolSpec[] = [
  {
    key: "drill",
    owner: "ana",
    // The HTML is deliberate: it shows that user text reaches emails escaped.
    name: "<b>Drill</b> & Saw",
    category: "power_tools",
    condition: "good",
    description:
      "18 V cordless drill with a matching jigsaw, two batteries, a charger and a case of wood and masonry bits. One battery lasts about an afternoon of work.",
  },
  {
    key: "shears",
    owner: "ana",
    name: "Tesoura de poda — jardim",
    category: "garden",
    condition: "good",
    description:
      "Bypass pruning shears, freshly sharpened. Good for roses, shrubs and branches up to 2 cm. Please wipe the blades after use.",
  },
  {
    key: "washer",
    owner: "ana",
    name: "Pressure washer",
    category: "cleaning",
    condition: "fair",
    description:
      "1800 W electric pressure washer with a 5 m hose and a patio brush. Needs an outdoor socket. The hose reel sticks a little but works.",
  },
  {
    key: "stove",
    owner: "ana",
    name: "Two-burner camping stove",
    category: "camping",
    condition: "good",
    description: "Folding gas stove with wind shields. Takes standard 450 g cartridges (not included). Fits in a car boot.",
  },
  {
    key: "ladder",
    owner: "joao",
    name: "Aluminium extension ladder (3.9 m)",
    category: "other",
    condition: "worn",
    description:
      "Two sections, reaches a first-floor gutter. Scuffed but solid, rubber feet replaced last spring. You'll need a car with roof bars or a hand carrying it.",
  },
  {
    key: "sockets",
    owner: "joao",
    name: "Socket wrench set",
    category: "hand_tools",
    condition: "new",
    description: "40-piece metric set, 1/4\" and 3/8\" drive, with a ratchet, extension bars and a hard case. Bought for one job, used once.",
  },
  {
    key: "mixer",
    owner: "joao",
    name: "Stand mixer",
    category: "kitchen",
    condition: "good",
    description: "4.8 L stand mixer with a dough hook, whisk and flat beater. Great for bread and birthday cakes. Comes clean, please return it clean.",
  },
  {
    key: "tent",
    owner: "mei",
    name: "Two-person tent",
    category: "camping",
    condition: "good",
    description: "Lightweight dome tent, pitches in ten minutes, with footprint and pegs. Dry it before packing it away, please.",
  },
  {
    key: "trimmer",
    owner: "mei",
    name: "Hedge trimmer",
    category: "garden",
    condition: "fair",
    description: "Corded 500 W hedge trimmer with a 55 cm blade and a 10 m extension lead. Blade guard included.",
  },
  {
    key: "carpet",
    owner: "mei",
    name: "Carpet cleaner",
    category: "cleaning",
    condition: "good",
    description: "Upright carpet and upholstery cleaner with a hand tool for stairs and car seats. Bring your own cleaning solution.",
  },
];

/** Tools given to the `attachEmail` account. The first one also marks attach mode as done. */
const ATTACH_TOOLS: readonly Omit<ToolSpec, "key" | "owner">[] = [
  {
    name: "Cordless leaf blower",
    category: "garden",
    condition: "good",
    description: "36 V leaf blower with two batteries. Quiet enough for an early Saturday. Clears a small garden on one charge.",
  },
  {
    name: "Tile cutter",
    category: "hand_tools",
    condition: "fair",
    description: "Manual 60 cm tile cutter with a spare scoring wheel. Handles ceramic and thin porcelain tiles.",
  },
];

/** Who acts and who is told, per event type. Mirrors the state machine in lib/loans.ts. */
function partiesOf(type: EventType): { actor: "lender" | "borrower"; notify: "lender" | "borrower" } {
  if (type === "loan.requested") return { actor: "borrower", notify: "lender" };
  const t = Object.values(TRANSITIONS).find((tr) => tr.event === type);
  if (!t) throw new Error(`no transition emits ${type}`);
  return { actor: t.actor, notify: t.notify };
}

type Step = { type: EventType; at: number };

/**
 * Inserts one loan. `history` steps become delivered outbox rows (timeline only, no email);
 * `live` goes through the real outbox and sends an email. Returns the loan id.
 */
async function addLoan(
  ctx: MutationCtx,
  a: {
    toolId: Id<"tools">;
    lenderId: Id<"users">;
    borrowerId: Id<"users">;
    startDate: string;
    endDate: string;
    status: LoanStatus;
    history: Step[];
    live?: Step;
  },
): Promise<Id<"loans">> {
  const steps = [...a.history, ...(a.live ? [a.live] : [])];
  const at = (type: EventType) => steps.find((s) => s.type === type)?.at;
  const createdAt = steps[0].at;
  const loanId = await ctx.db.insert("loans", {
    toolId: a.toolId,
    borrowerId: a.borrowerId,
    lenderId: a.lenderId,
    startDate: a.startDate,
    endDate: a.endDate,
    status: a.status,
    decidedAt: at("loan.approved") ?? at("loan.declined") ?? at("loan.cancelled"),
    returnClaimedAt: a.status === "return_claimed" ? at("loan.return_claimed") : undefined,
    returnedAt: at("loan.returned"),
    createdAt,
    updatedAt: steps[steps.length - 1].at,
  });
  const ids = (type: EventType) => {
    const p = partiesOf(type);
    const id = (party: "lender" | "borrower") => (party === "lender" ? a.lenderId : a.borrowerId);
    return { recipientId: id(p.notify), actorId: id(p.actor) };
  };

  for (const step of a.history) {
    const { recipientId, actorId } = ids(step.type);
    await ctx.db.insert("webhookDeliveries", {
      eventId: crypto.randomUUID(),
      loanId,
      type: step.type,
      recipientId,
      actorId,
      status: "sent",
      attempts: 0,
      notifyStatus: "sent",
      processedAt: step.at + 2_000,
      createdAt: step.at,
    });
    await ctx.db.insert("automationEvents", {
      loanId,
      kind: "notification_sent",
      detail: recipientId === a.lenderId ? "Lender notified" : "Borrower notified",
      at: step.at + 2_000,
    });
  }

  if (a.live) {
    const { recipientId, actorId } = ids(a.live.type);
    await enqueueLoanEvent(ctx, { loanId, type: a.live.type, recipientId, actorId });
    // Date the event when it "happened" so the timeline reads in order. The email is sent now.
    const row = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (row) await ctx.db.patch(row._id, { createdAt: a.live.at });
  }
  return loanId;
}

async function seedBase(ctx: MutationCtx, now: number) {
  const today = todayUtc(now);
  const d = (n: number) => addDays(today, n);
  const ago = (days: number, hours = 0) => now - days * DAY_MS - hours * HOUR_MS;

  const users = {} as Record<UserKey, Id<"users">>;
  for (const u of SEED_USERS) {
    users[u.key] = await ctx.db.insert("users", {
      clerkId: u.clerkId,
      name: u.name,
      email: u.email,
      role: "user",
      trustedLender: u.trustedLender,
      createdAt: ago(60),
      updatedAt: ago(60),
    });
  }

  const tools: Record<string, { id: Id<"tools">; ownerId: Id<"users"> }> = {};
  for (const [i, t] of SEED_TOOLS.entries()) {
    const ownerId = users[t.owner];
    const id = await ctx.db.insert("tools", {
      ownerId,
      name: t.name,
      category: t.category,
      condition: t.condition,
      description: t.description,
      status: "active",
      createdAt: ago(45 - i * 3),
      updatedAt: ago(45 - i * 3),
    });
    tools[t.key] = { id, ownerId };
  }

  const loan = (toolKey: string, borrower: UserKey, rest: Omit<Parameters<typeof addLoan>[1], "toolId" | "lenderId" | "borrowerId">) =>
    addLoan(ctx, { toolId: tools[toolKey].id, lenderId: tools[toolKey].ownerId, borrowerId: users[borrower], ...rest });

  // pending: João asks Ana for the drill. Live: Ana gets "New request" (the HTML-named tool).
  await loan("drill", "joao", {
    startDate: d(2),
    endDate: d(4),
    status: "pending",
    history: [],
    live: { type: "loan.requested", at: ago(0, 2) },
  });
  // pending: Mei asks Ana for the camping stove for a weekend away.
  await loan("stove", "mei", {
    startDate: d(7),
    endDate: d(9),
    status: "pending",
    history: [],
    live: { type: "loan.requested", at: ago(0, 5) },
  });
  // approved and overdue (ended 3 days ago): João still has Ana's shears. The overdue workflow
  // reminds him. Live: João gets "Approved" (accented name and tool).
  await loan("shears", "joao", {
    startDate: d(-10),
    endDate: d(-3),
    status: "approved",
    history: [{ type: "loan.requested", at: ago(12) }],
    live: { type: "loan.approved", at: ago(11, 20) },
  });
  // approved and current: Mei is baking with João's mixer this week.
  await loan("mixer", "mei", {
    startDate: d(-1),
    endDate: d(5),
    status: "approved",
    history: [{ type: "loan.requested", at: ago(3) }],
    live: { type: "loan.approved", at: ago(2, 22) },
  });
  // return_claimed: Ana says she brought Mei's tent back; Mei has not confirmed yet.
  await loan("tent", "ana", {
    startDate: d(-7),
    endDate: d(-1),
    status: "return_claimed",
    history: [
      { type: "loan.requested", at: ago(9) },
      { type: "loan.approved", at: ago(8, 21) },
      { type: "loan.return_claimed", at: ago(0, 3) },
    ],
  });
  // returned: Mei borrowed the pressure washer last month and brought it back.
  await loan("washer", "mei", {
    startDate: d(-20),
    endDate: d(-17),
    status: "returned",
    history: [
      { type: "loan.requested", at: ago(22) },
      { type: "loan.approved", at: ago(21, 20) },
      { type: "loan.return_claimed", at: ago(17, 4) },
      { type: "loan.returned", at: ago(16, 22) },
    ],
  });
  // declined: João's socket set was already promised to someone else.
  await loan("sockets", "mei", {
    startDate: d(-6),
    endDate: d(-5),
    status: "declined",
    history: [
      { type: "loan.requested", at: ago(8) },
      { type: "loan.declined", at: ago(7, 18) },
    ],
  });
  // cancelled: Ana asked for the hedge trimmer, then borrowed one from family instead.
  await loan("trimmer", "ana", {
    startDate: d(5),
    endDate: d(6),
    status: "cancelled",
    history: [
      { type: "loan.requested", at: ago(1, 6) },
      { type: "loan.cancelled", at: ago(1, 2) },
    ],
  });

  return { users: SEED_USERS.length, tools: SEED_TOOLS.length, loans: 8 };
}

/** Gives a real account (signed in once) a listing with an incoming request and an overdue loan. */
async function seedAttached(ctx: MutationCtx, now: number, userId: Id<"users">) {
  const owned = await ctx.db
    .query("tools")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  if (owned.some((t) => t.name === ATTACH_TOOLS[0].name && t.status === "active")) return "already attached" as const;

  const seedUser = async (clerkId: string) => {
    const u = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (!u) throw new Error(`seed user ${clerkId} missing`);
    return u._id;
  };
  const ana = await seedUser("seed|ana");
  const joao = await seedUser("seed|joao");
  const today = todayUtc(now);
  const d = (n: number) => addDays(today, n);
  const ago = (days: number, hours = 0) => now - days * DAY_MS - hours * HOUR_MS;

  const toolIds: Id<"tools">[] = [];
  for (const t of ATTACH_TOOLS) {
    toolIds.push(await ctx.db.insert("tools", { ownerId: userId, ...t, status: "active", createdAt: ago(20), updatedAt: ago(20) }));
  }
  // Incoming: João would like the leaf blower this weekend.
  await addLoan(ctx, {
    toolId: toolIds[0],
    lenderId: userId,
    borrowerId: joao,
    startDate: d(3),
    endDate: d(5),
    status: "pending",
    history: [],
    live: { type: "loan.requested", at: ago(0, 1) },
  });
  // Outgoing and overdue: the account borrowed Ana's pressure washer and is two days late.
  const washer = await ctx.db
    .query("tools")
    .withIndex("by_owner", (q) => q.eq("ownerId", ana))
    .filter((q) => q.eq(q.field("name"), "Pressure washer"))
    .first();
  if (!washer) throw new Error("seed tool Pressure washer missing");
  await addLoan(ctx, {
    toolId: washer._id,
    lenderId: ana,
    borrowerId: userId,
    startDate: d(-9),
    endDate: d(-2),
    status: "approved",
    history: [{ type: "loan.requested", at: ago(11) }],
    live: { type: "loan.approved", at: ago(10, 21) },
  });
  return "attached" as const;
}

export const dev = internalMutation({
  args: { attachEmail: v.optional(v.string()) },
  handler: async (ctx, { attachEmail }) => {
    const now = Date.now();
    // Check the account first, so a typo does not leave a half-done seed.
    let attachUserId: Id<"users"> | null = null;
    if (attachEmail !== undefined) {
      const email = attachEmail.trim().toLowerCase();
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (!user) fail("NOT_FOUND", "No user with that email. Sign in to the app once, then run the seed again.");
      if (user.clerkId.startsWith("seed|")) fail("INVALID", "attachEmail must be a real account, not a seed user.");
      attachUserId = user._id;
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", "seed|ana"))
      .unique();
    const base = existing ? ("already seeded" as const) : await seedBase(ctx, now);
    const attached = attachUserId ? await seedAttached(ctx, now, attachUserId) : undefined;
    return { base, attached };
  },
});
