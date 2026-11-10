import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import { LOAN_STATUSES, type LoanStatus } from "./constants";
import { LOAN_ACTIONS, TRANSITIONS, allowedActions, checkTransition, isOverdue, type LoanAction } from "./loans";

const lender = "lender" as Id<"users">;
const borrower = "borrower" as Id<"users">;
const stranger = "stranger" as Id<"users">;
// Dates where every date rule passes: requested for the future, not yet picked up.
const TODAY = "2026-11-09";
const loanIn = (status: LoanStatus, startDate = "2026-11-10", endDate = "2026-11-12") => ({
  status,
  lenderId: lender,
  borrowerId: borrower,
  startDate,
  endDate,
});

// The state diagram written out independently of the implementation:
// action -> [allowed from-statuses, actor, to-status, event, who is notified].
const SPEC: Record<LoanAction, [LoanStatus[], "lender" | "borrower", LoanStatus, string, "lender" | "borrower"]> = {
  approve: [["pending"], "lender", "approved", "loan.approved", "borrower"],
  decline: [["pending"], "lender", "declined", "loan.declined", "borrower"],
  cancel: [["pending", "approved"], "borrower", "cancelled", "loan.cancelled", "lender"],
  revoke: [["approved"], "lender", "cancelled", "loan.cancelled", "borrower"],
  claim_return: [["approved"], "borrower", "return_claimed", "loan.return_claimed", "lender"],
  confirm_return: [["return_claimed"], "lender", "returned", "loan.returned", "borrower"],
  dispute_return: [["return_claimed"], "lender", "approved", "loan.return_disputed", "borrower"],
  mark_returned: [["approved", "return_claimed"], "lender", "returned", "loan.returned", "borrower"],
};

describe("loan state machine", () => {
  test("TRANSITIONS is exactly the §6 diagram", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...LOAN_ACTIONS].sort());
    for (const action of LOAN_ACTIONS) {
      const [from, actor, to, event, notify] = SPEC[action];
      expect(TRANSITIONS[action]).toEqual({ from, actor, to, event, notify });
    }
  });

  // Every (action × status × actor) cell.
  const cells = LOAN_ACTIONS.flatMap((action) =>
    LOAN_STATUSES.flatMap((status) =>
      (["lender", "borrower", "stranger"] as const).map((who) => ({ action, status, who })),
    ),
  );
  test.each(cells)("$action from $status by $who", ({ action, status, who }) => {
    const [from, actor, to] = SPEC[action];
    const viewer = { lender, borrower, stranger }[who];
    const result = checkTransition(loanIn(status), viewer, action, TODAY);
    if (who !== actor) expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    else if (!from.includes(status)) expect(result).toEqual({ ok: false, code: "CONFLICT" });
    else expect(result).toEqual({ ok: true, transition: TRANSITIONS[action], to });
  });

  test("allowedActions lists what each party can do, without duplicate buttons", () => {
    expect(allowedActions(loanIn("pending"), lender, TODAY)).toEqual(["approve", "decline"]);
    expect(allowedActions(loanIn("pending"), borrower, TODAY)).toEqual(["cancel"]);
    // Before pickup either party can call an approved loan off.
    expect(allowedActions(loanIn("approved"), lender, TODAY)).toEqual(["revoke", "mark_returned"]);
    expect(allowedActions(loanIn("approved"), borrower, TODAY)).toEqual(["cancel", "claim_return"]);
    // Once it has started, only the return path is left.
    expect(allowedActions(loanIn("approved", "2026-11-08"), lender, TODAY)).toEqual(["mark_returned"]);
    expect(allowedActions(loanIn("approved", "2026-11-08"), borrower, TODAY)).toEqual(["claim_return"]);
    // mark_returned is also valid here, but it does the same as confirm_return, so it isn't offered twice.
    expect(allowedActions(loanIn("return_claimed"), lender, TODAY)).toEqual(["confirm_return", "dispute_return"]);
    expect(allowedActions(loanIn("return_claimed"), borrower, TODAY)).toEqual([]);
    for (const status of ["returned", "declined", "cancelled"] as const) {
      expect(allowedActions(loanIn(status), lender, TODAY)).toEqual([]);
      expect(allowedActions(loanIn(status), borrower, TODAY)).toEqual([]);
    }
    for (const status of LOAN_STATUSES) expect(allowedActions(loanIn(status), stranger, TODAY)).toEqual([]);
  });

  test("isOverdue: approved past endDate only", () => {
    expect(isOverdue({ status: "approved", endDate: "2026-11-08" }, "2026-11-09")).toBe(true);
    expect(isOverdue({ status: "approved", endDate: "2026-11-09" }, "2026-11-09")).toBe(false);
    expect(isOverdue({ status: "return_claimed", endDate: "2026-11-01" }, "2026-11-09")).toBe(false);
    expect(isOverdue({ status: "pending", endDate: "2026-11-01" }, "2026-11-09")).toBe(false);
  });
});

describe("date rules", () => {
  test("a request whose dates have passed can't be approved, only declined", () => {
    const stale = loanIn("pending", "2026-11-01", "2026-11-08");
    expect(checkTransition(stale, lender, "approve", TODAY)).toEqual({ ok: false, code: "CONFLICT" });
    expect(checkTransition(stale, lender, "decline", TODAY).ok).toBe(true);
    expect(allowedActions(stale, lender, TODAY)).toEqual(["decline"]);
    // Ending today is still approvable.
    expect(checkTransition(loanIn("pending", "2026-11-09", "2026-11-09"), lender, "approve", TODAY).ok).toBe(true);
  });

  test("an approved loan can only be called off before its start date", () => {
    const startsToday = loanIn("approved", "2026-11-09", "2026-11-12");
    expect(checkTransition(startsToday, borrower, "cancel", TODAY)).toEqual({ ok: false, code: "CONFLICT" });
    expect(checkTransition(startsToday, lender, "revoke", TODAY)).toEqual({ ok: false, code: "CONFLICT" });
    const startsTomorrow = loanIn("approved", "2026-11-10", "2026-11-12");
    expect(checkTransition(startsTomorrow, borrower, "cancel", TODAY).ok).toBe(true);
    expect(checkTransition(startsTomorrow, lender, "revoke", TODAY).ok).toBe(true);
  });

  test("cancelling a pending request ignores dates", () => {
    expect(checkTransition(loanIn("pending", "2026-11-01", "2026-11-02"), borrower, "cancel", TODAY).ok).toBe(true);
  });
});
