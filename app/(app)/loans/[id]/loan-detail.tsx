"use client";

import { format } from "date-fns";
import { ArrowLeft, Lock, Mail, SearchX } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityList } from "@/components/activity-list";
import { LoanActions } from "@/components/loan-actions";
import {
  badgeOverdueDays,
  formatDay,
  formatWeekday,
  loanLength,
  overdueDays,
  pluralDays,
  todayUtc,
  type ViewerRole,
} from "@/components/loan-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { TrustedBadge } from "@/components/ui-kit/trusted-badge";
import { useAuthedQuery } from "@/components/use-authed-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorCode, errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const BACK: Record<"borrower" | "lender" | "admin", { href: string; label: string }> = {
  borrower: { href: "/me/requests", label: "Your requests" },
  lender: { href: "/me/incoming", label: "Incoming requests" },
  admin: { href: "/admin?tab=loans", label: "Admin" },
};

/** A malformed id fails Convex's argument validator; to a person that is just "not found". */
function isNotFound(error: Error) {
  return errorCode(error) === "NOT_FOUND" || /ArgumentValidationError|Value does not match validator/.test(error.message);
}

export function LoanDetail({ loanId }: { loanId: string }) {
  const result = useAuthedQuery(api.loans.get, { loanId: loanId as Id<"loans"> });
  const me = useAuthedQuery(api.users.me, {});

  if (result.status === "pending" || me.status === "pending") return <LoanDetailSkeleton />;
  if (result.status === "error") {
    if (errorCode(result.error) === "FORBIDDEN") {
      return (
        <Problem
          icon={Lock}
          title="You don't have access to this loan"
          description="Only the lender and the borrower can open it."
        />
      );
    }
    if (isNotFound(result.error)) {
      return <Problem icon={SearchX} title="Loan not found" description="The link may be wrong or out of date." />;
    }
    return <Problem icon={SearchX} title="This loan can't be loaded" description={errorMessage(result.error)} />;
  }

  const loan = result.data;
  const isAdmin = me.status === "success" && me.data?.role === "admin";
  const role = loan.viewerRole;
  const back = BACK[role ?? (isAdmin ? "admin" : "borrower")];
  const counterpartName = role === "borrower" ? loan.lender.name : role === "lender" ? loan.borrower.name : null;
  const today = todayUtc();
  const late = loan.overdue ? overdueDays(loan.endDate, today) : 0;

  return (
    <article className="flex flex-col gap-6">
      <div>
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {back.label}
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words md:text-3xl">{loan.tool.name}</h1>
          <StatusBadge status={loan.status} overdueDays={badgeOverdueDays(loan, today)} className="mt-1.5" />
        </div>
      </div>

      {/* The borrow slip: who lends to whom, and for which days. */}
      <section aria-label="Loan details" className="tool-tag relative bg-tag py-4 pr-4 pl-10 text-tag-foreground md:pr-6 md:pl-12">
        <span
          aria-hidden="true"
          className="absolute top-6 left-4 size-3 rounded-full bg-background ring-1 ring-tag-foreground/25 md:left-5"
        />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
          <SlipField label="Lender">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {loan.lender.name}
                {role === "lender" ? <span className="font-normal text-tag-foreground/70"> (you)</span> : null}
              </span>
              {loan.lender.trustedLender ? <TrustedBadge className="bg-card/60" /> : null}
            </span>
          </SlipField>
          <SlipField label="Borrower">
            {loan.borrower.name}
            {role === "borrower" ? <span className="font-normal text-tag-foreground/70"> (you)</span> : null}
          </SlipField>
          <SlipField label="Out">
            {formatWeekday(loan.startDate)}, {formatDay(loan.startDate, today)}
          </SlipField>
          <SlipField label="Back by">
            {formatWeekday(loan.endDate)}, {formatDay(loan.endDate, today)}
            <span className={cn("block text-sm font-normal text-tag-foreground/70", late > 0 && "text-destructive")}>
              {late > 0 ? `${pluralDays(late)} late` : pluralDays(loanLength(loan.startDate, loan.endDate))}
            </span>
          </SlipField>
        </dl>
      </section>

      <Contact
        status={loan.status}
        role={role}
        email={loan.counterpartEmail}
        name={counterpartName}
      />

      {loan.allowedActions.length > 0 ? (
        <LoanActions
          loanId={loan._id}
          actions={loan.allowedActions}
          counterpartName={counterpartName ?? "The other party"}
          size="lg"
        />
      ) : null}

      <div className="grid gap-8 border-t pt-6 md:grid-cols-2 md:gap-12">
        <section aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className="mb-4 text-lg font-semibold tracking-tight">
            Timeline
          </h2>
          <Timeline items={loan.timeline} />
        </section>
        <section aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="mb-4 text-lg font-semibold tracking-tight">
            Emails and reminders
          </h2>
          <ActivityList items={loan.activity} />
        </section>
      </div>
    </article>
  );
}

function SlipField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-tag-foreground/70">{label}</dt>
      <dd className="mt-0.5 font-semibold break-words">{children}</dd>
    </div>
  );
}

function Contact({
  status,
  role,
  email,
  name,
}: {
  status: string;
  role: ViewerRole;
  email: string | null;
  name: string | null;
}) {
  if (email) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Mail className="size-4 text-primary" aria-hidden="true" />
        <span>Contact {name ?? "the other party"}:</span>
        <a
          href={`mailto:${email}`}
          className="font-medium break-all text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {email}
        </a>
      </p>
    );
  }
  if (status === "pending" && role !== null) {
    return (
      <p className="text-sm text-muted-foreground">
        Once the request is approved, you&apos;ll both see each other&apos;s email here to arrange the pickup.
      </p>
    );
  }
  return null;
}

function Timeline({ items }: { items: { label: string; at: number }[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No status changes yet.</p>;
  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <li key={`${item.at}-${i}`} className="relative flex items-baseline gap-3 pl-6">
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-background bg-muted-foreground/40",
                last && "bg-primary",
              )}
            />
            <span className={cn("text-sm", last && "font-semibold")}>{item.label}</span>
            <time
              dateTime={new Date(item.at).toISOString()}
              className="ml-auto shrink-0 text-sm text-muted-foreground"
            >
              {format(item.at, "MMM d, HH:mm")}
            </time>
          </li>
        );
      })}
    </ol>
  );
}

function Problem({ icon, title, description }: { icon: typeof Lock; title: string; description: string }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={
        <Button asChild variant="outline">
          <Link href="/me/requests">Go to your requests</Link>
        </Button>
      }
    />
  );
}

export function LoanDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-28 w-full rounded-md" />
      <Skeleton className="h-8 w-40" />
      <div className="grid gap-8 md:grid-cols-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}
