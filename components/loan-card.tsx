"use client";

import { Inbox, Send } from "lucide-react";
import Link from "next/link";
import { ActivityLine } from "@/components/activity-list";
import { LoanActions } from "@/components/loan-actions";
import { badgeOverdueDays, formatRange, groupLoans, loanLength, pluralDays, todayUtc } from "@/components/loan-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { useAuthedQuery } from "@/components/use-authed-query";
import { TrustedBadge } from "@/components/ui-kit/trusted-badge";
import { api } from "@/convex/_generated/api";
import type { LoanRow } from "@/convex/loans";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type LoanCardProps = {
  row: LoanRow;
  /** Which side the viewer is on: Requests pages are "borrower", Incoming pages are "lender". */
  as: "borrower" | "lender";
  today: string;
  className?: string;
};

/** A loan in a list: tool, the other party, dates, status, the latest automation line, and actions. */
export function LoanCard({ row, as, today, className }: LoanCardProps) {
  const counterpart = as === "borrower" ? row.lender.name : row.borrower.name;
  return (
    <article
      className={cn(
        "relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors has-[a[data-card-link]:hover]:border-primary/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base leading-snug font-semibold break-words">
            <Link
              href={`/loans/${row._id}`}
              data-card-link
              className="rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
            >
              {row.tool.name}
            </Link>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{as === "borrower" ? `Lent by ${counterpart}` : `Requested by ${counterpart}`}</span>
            {as === "borrower" && row.lender.trustedLender ? <TrustedBadge /> : null}
          </p>
        </div>
        <StatusBadge status={row.status} overdueDays={badgeOverdueDays(row, today)} className="mt-0.5" />
      </div>

      <p className="text-sm">
        <span className="font-medium">{formatRange(row.startDate, row.endDate, today)}</span>
        <span className="text-muted-foreground"> ({pluralDays(loanLength(row.startDate, row.endDate))})</span>
      </p>

      {row.lastActivity ? <ActivityLine item={row.lastActivity} /> : null}

      {row.allowedActions.length > 0 ? (
        <LoanActions
          loanId={row._id}
          actions={row.allowedActions}
          counterpartName={counterpart}
          className="relative z-10 pt-1"
        />
      ) : null}
    </article>
  );
}

const EMPTY = {
  myRequests: {
    icon: Send,
    title: "No requests yet",
    description: "Find a tool on Browse and pick the days you need it. Your requests show up here.",
    action: { href: "/tools", label: "Browse tools" },
  },
  incoming: {
    icon: Inbox,
    title: "No one has asked to borrow yet",
    description: "When a neighbor requests one of your tools, you approve or decline it here.",
    action: { href: "/tools/new", label: "List a tool" },
  },
} as const;

/**
 * A live list of the viewer's loans, split into "Needs your action" (the server offers an
 * action) and "Other". Requests are seen as the borrower, Incoming as the lender.
 */
export function LoanBoard({ source }: { source: "myRequests" | "incoming" }) {
  const result = useAuthedQuery(source === "myRequests" ? api.loans.myRequests : api.loans.incoming, {});
  const as = source === "myRequests" ? "borrower" : "lender";

  if (result.status === "pending") return <LoanBoardSkeleton />;
  if (result.status === "error") {
    return <p className="text-sm text-destructive">{errorMessage(result.error)}</p>;
  }
  if (result.data.length === 0) {
    const empty = EMPTY[source];
    return (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        description={empty.description}
        action={
          <Button asChild>
            <Link href={empty.action.href}>{empty.action.label}</Link>
          </Button>
        }
      />
    );
  }

  const today = todayUtc();
  const { needsAction, other } = groupLoans(result.data);
  return (
    <div className="flex flex-col gap-8">
      {needsAction.length > 0 ? (
        <LoanGroup title="Needs your action" count={needsAction.length} rows={needsAction} as={as} today={today} />
      ) : null}
      {other.length > 0 ? <LoanGroup title="Other" count={other.length} rows={other} as={as} today={today} /> : null}
    </div>
  );
}

function LoanGroup({
  title,
  count,
  rows,
  as,
  today,
}: {
  title: string;
  count: number;
  rows: LoanRow[];
  as: "borrower" | "lender";
  today: string;
}) {
  const id = `group-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 flex items-baseline gap-2 text-lg font-semibold tracking-tight">
        {title}
        <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((row) => (
          <li key={row._id} className="min-w-0">
            <LoanCard row={row} as={as} today={today} className="h-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LoanBoardSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  );
}
