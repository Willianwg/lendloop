// The loan state machine (spec §6). Every status change goes through `TRANSITIONS`; the
// mutations in loans.ts only add the side effects (overlap checks, timestamps, events).
//
//   pending ──approve──▶ approved ──claim_return──▶ return_claimed ──confirm_return──▶ returned
//      │                    │  ▲                        │
//      ├─decline─▶ declined │  └────dispute_return──────┘
//      └─cancel──▶ cancelled└──────────mark_returned (also from return_claimed)──────▶ returned
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { EventType, LoanStatus } from "./constants";

export const LOAN_ACTIONS = [
  "approve",
  "decline",
  "cancel",
  "claim_return",
  "confirm_return",
  "dispute_return",
  "mark_returned",
] as const;
export type LoanAction = (typeof LOAN_ACTIONS)[number];
export const vLoanAction = v.union(
  v.literal("approve"),
  v.literal("decline"),
  v.literal("cancel"),
  v.literal("claim_return"),
  v.literal("confirm_return"),
  v.literal("dispute_return"),
  v.literal("mark_returned"),
);

type Party = "lender" | "borrower";
export type Transition = { from: LoanStatus[]; to: LoanStatus; actor: Party; event: EventType; notify: Party };

export const TRANSITIONS: Record<LoanAction, Transition> = {
  approve: { from: ["pending"], to: "approved", actor: "lender", event: "loan.approved", notify: "borrower" },
  decline: { from: ["pending"], to: "declined", actor: "lender", event: "loan.declined", notify: "borrower" },
  cancel: { from: ["pending"], to: "cancelled", actor: "borrower", event: "loan.cancelled", notify: "lender" },
  claim_return: {
    from: ["approved"],
    to: "return_claimed",
    actor: "borrower",
    event: "loan.return_claimed",
    notify: "lender",
  },
  confirm_return: { from: ["return_claimed"], to: "returned", actor: "lender", event: "loan.returned", notify: "borrower" },
  // A dispute puts the loan back to approved, so it is overdue again if past its end date.
  dispute_return: {
    from: ["return_claimed"],
    to: "approved",
    actor: "lender",
    event: "loan.return_disputed",
    notify: "borrower",
  },
  // The lender can close a loan directly, whether or not the borrower claimed the return.
  mark_returned: {
    from: ["approved", "return_claimed"],
    to: "returned",
    actor: "lender",
    event: "loan.returned",
    notify: "borrower",
  },
};

/** A loan in one of these states means the borrower has (or should have) the tool. */
export const ACTIVE_STATUSES = ["approved", "return_claimed"] as const satisfies readonly LoanStatus[];

type LoanParties = Pick<Doc<"loans">, "status" | "lenderId" | "borrowerId">;

function partyOf(loan: LoanParties, viewerId: Id<"users">): Party | null {
  if (viewerId === loan.lenderId) return "lender";
  if (viewerId === loan.borrowerId) return "borrower";
  return null;
}

/**
 * Whether `viewerId` may apply `action` to `loan` now. The actor is checked first, so a
 * non-party always gets FORBIDDEN (admins included: they don't act on other people's loans).
 */
export function checkTransition(
  loan: LoanParties,
  viewerId: Id<"users">,
  action: LoanAction,
): { ok: true; transition: Transition; to: LoanStatus } | { ok: false; code: "FORBIDDEN" | "CONFLICT" } {
  const transition = TRANSITIONS[action];
  if (partyOf(loan, viewerId) !== transition.actor) return { ok: false, code: "FORBIDDEN" };
  if (!transition.from.includes(loan.status)) return { ok: false, code: "CONFLICT" };
  return { ok: true, transition, to: transition.to };
}

/** The actions the UI should offer `viewerId` on `loan`. */
export function allowedActions(loan: LoanParties, viewerId: Id<"users">): LoanAction[] {
  const actions = LOAN_ACTIONS.filter((action) => checkTransition(loan, viewerId, action).ok);
  // After a return claim, confirm_return and mark_returned do the same thing; offer one button.
  return actions.includes("confirm_return") ? actions.filter((a) => a !== "mark_returned") : actions;
}

/** Overdue = still approved after the end date. A return claim pauses it (no reminders). */
export function isOverdue(loan: Pick<Doc<"loans">, "status" | "endDate">, today: string): boolean {
  return loan.status === "approved" && loan.endDate < today;
}

export async function activeLoansOfTool(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans">[]> {
  const perStatus = await Promise.all(
    ACTIVE_STATUSES.map((status) =>
      ctx.db
        .query("loans")
        .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", status))
        .collect(),
    ),
  );
  return perStatus.flat();
}
