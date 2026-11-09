import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import { LOAN_STATUSES, type LoanStatus } from "./constants";
import { LOAN_ACTIONS, TRANSITIONS, allowedActions, checkTransition, isOverdue, type LoanAction } from "./loans";

const lender = "lender" as Id<"users">;
const borrower = "borrower" as Id<"users">;
const stranger = "stranger" as Id<"users">;
const loanIn = (status: LoanStatus) => ({ status, lenderId: lender, borrowerId: borrower, endDate: "2026-11-08" });

// The spec §6 diagram written out independently of the implementation:
// action -> [allowed from-statuses, actor, to-status, event, who is notified].
const SPEC: Record<LoanAction, [LoanStatus[], "lender" | "borrower", LoanStatus, string, "lender" | "borrower"]> = {
  approve: [["pending"], "lender", "approved", "loan.approved", "borrower"],
  decline: [["pending"], "lender", "declined", "loan.declined", "borrower"],
  cancel: [["pending"], "borrower", "cancelled", "loan.cancelled", "lender"],
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
    const result = checkTransition(loanIn(status), viewer, action);
    if (who !== actor) expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    else if (!from.includes(status)) expect(result).toEqual({ ok: false, code: "CONFLICT" });
    else expect(result).toEqual({ ok: true, transition: TRANSITIONS[action], to });
  });

  test("allowedActions lists what each party can do, without duplicate buttons", () => {
    expect(allowedActions(loanIn("pending"), lender)).toEqual(["approve", "decline"]);
    expect(allowedActions(loanIn("pending"), borrower)).toEqual(["cancel"]);
    expect(allowedActions(loanIn("approved"), lender)).toEqual(["mark_returned"]);
    expect(allowedActions(loanIn("approved"), borrower)).toEqual(["claim_return"]);
    // mark_returned is also valid here, but it does the same as confirm_return, so it isn't offered twice.
    expect(allowedActions(loanIn("return_claimed"), lender)).toEqual(["confirm_return", "dispute_return"]);
    expect(allowedActions(loanIn("return_claimed"), borrower)).toEqual([]);
    for (const status of ["returned", "declined", "cancelled"] as const) {
      expect(allowedActions(loanIn(status), lender)).toEqual([]);
      expect(allowedActions(loanIn(status), borrower)).toEqual([]);
    }
    for (const status of LOAN_STATUSES) expect(allowedActions(loanIn(status), stranger)).toEqual([]);
  });

  test("isOverdue: approved past endDate only", () => {
    expect(isOverdue({ status: "approved", endDate: "2026-11-08" }, "2026-11-09")).toBe(true);
    expect(isOverdue({ status: "approved", endDate: "2026-11-09" }, "2026-11-09")).toBe(false);
    expect(isOverdue({ status: "return_claimed", endDate: "2026-11-01" }, "2026-11-09")).toBe(false);
    expect(isOverdue({ status: "pending", endDate: "2026-11-01" }, "2026-11-09")).toBe(false);
  });
});
