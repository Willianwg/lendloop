"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A data set that is a table from `md` up and a stack of cards below it. Both are rendered;
 * CSS shows one (display:none also drops the other from the accessibility tree).
 */
export function ResponsiveData({ table, cards }: { table: ReactNode; cards: ReactNode }) {
  return (
    <>
      <div className="hidden rounded-xl border bg-card md:block">{table}</div>
      <ul className="flex flex-col gap-3 md:hidden">{cards}</ul>
    </>
  );
}

/** A card in the stacked (mobile) view of an admin table. */
export function DataCard({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn("flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4", className)}>{children}</li>;
}

export function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

/** Relative + absolute time for admin rows. */
export function When({ at, children }: { at: number; children: ReactNode }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className="tabular-nums">
      {children}
    </time>
  );
}
