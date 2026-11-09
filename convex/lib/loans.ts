// Loan rules shared by tools.ts and loans.ts.
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { LoanStatus } from "./constants";

/** A loan in one of these states means the borrower has (or should have) the tool. */
export const ACTIVE_STATUSES = ["approved", "return_claimed"] as const satisfies readonly LoanStatus[];

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
