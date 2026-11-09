"use client";

import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ActivityLine } from "@/components/activity-list";
import { DataCard, ResponsiveData, TableSkeleton } from "@/components/admin/admin-shared";
import { badgeOverdueDays, formatRange, todayUtc } from "@/components/loan-view";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { useAuthedQuery } from "@/components/use-authed-query";
import { api } from "@/convex/_generated/api";
import { LOAN_STATUSES, type LoanStatus } from "@/convex/lib/constants";
import type { LoanRow } from "@/convex/loans";
import { errorMessage } from "@/lib/errors";

const STATUS_LABELS: Record<LoanStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  return_claimed: "Return claimed",
  returned: "Returned",
  declined: "Declined",
  cancelled: "Cancelled",
};

/** Every loan on the board, filterable by status or "overdue only". */
export function LoansTable() {
  const [status, setStatus] = useState<LoanStatus | "all">("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  // Overdue loans are approved by definition, so the status filter is set aside while it's on.
  const result = useAuthedQuery(
    api.loans.adminList,
    overdueOnly ? { overdueOnly: true } : status === "all" ? {} : { status },
  );
  const today = todayUtc();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="loan-status" className="text-sm text-muted-foreground">
            Status
          </Label>
          <Select value={status} onValueChange={(v) => setStatus(v as LoanStatus | "all")} disabled={overdueOnly}>
            <SelectTrigger id="loan-status" className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {LOAN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="overdue-only" checked={overdueOnly} onCheckedChange={setOverdueOnly} />
          <Label htmlFor="overdue-only">Overdue only</Label>
        </div>
      </div>

      {result.status === "pending" ? (
        <TableSkeleton />
      ) : result.status === "error" ? (
        <p className="text-sm text-destructive">{errorMessage(result.error)}</p>
      ) : result.data.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={overdueOnly ? "Nothing is overdue" : "No loans match"}
          description={
            overdueOnly ? "Every approved loan is still within its dates." : "Try another status, or All statuses."
          }
        />
      ) : (
        <LoanRows rows={result.data} today={today} />
      )}
    </div>
  );
}

function LoanRows({ rows, today }: { rows: LoanRow[]; today: string }) {
  return (
    <ResponsiveData
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Tool</TableHead>
              <TableHead>Borrower</TableHead>
              <TableHead>Lender</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4">Latest activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row._id}>
                <TableCell className="max-w-56 pl-4 font-medium whitespace-normal">
                  <ToolLink row={row} />
                </TableCell>
                <TableCell>{row.borrower.name}</TableCell>
                <TableCell>{row.lender.name}</TableCell>
                <TableCell className="tabular-nums">{formatRange(row.startDate, row.endDate, today)}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} overdueDays={badgeOverdueDays(row, today)} />
                </TableCell>
                <TableCell className="max-w-64 pr-4">
                  {row.lastActivity ? <ActivityLine item={row.lastActivity} /> : <span className="text-muted-foreground">None</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      cards={rows.map((row) => (
        <DataCard key={row._id}>
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 font-semibold break-words">
              <ToolLink row={row} />
            </span>
            <StatusBadge status={row.status} overdueDays={badgeOverdueDays(row, today)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {row.borrower.name} borrows from {row.lender.name}
          </p>
          <p className="text-sm font-medium">{formatRange(row.startDate, row.endDate, today)}</p>
          {row.lastActivity ? <ActivityLine item={row.lastActivity} /> : null}
        </DataCard>
      ))}
    />
  );
}

function ToolLink({ row }: { row: LoanRow }) {
  return (
    <Link
      href={`/loans/${row._id}`}
      className="underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {row.tool.name}
    </Link>
  );
}
