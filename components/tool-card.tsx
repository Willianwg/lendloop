import type { ReactNode } from "react";
import { formatIsoDate } from "@/app/(app)/tools/_lib/dates";
import { firstName } from "@/app/(app)/tools/_lib/tool-input";
import type { ToolView } from "@/app/(app)/tools/_lib/use-viewer-ready";
import { Skeleton } from "@/components/ui/skeleton";
import { TrustedBadge } from "@/components/ui-kit/trusted-badge";
import { formatCategory, formatCondition } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ToolCardProps = {
  tool: ToolView;
  /** The card's action area: "Request" on Browse, Edit/Delete on Listings. */
  actions?: ReactNode;
  /** Extra line under the description, e.g. the pending-request count on Listings. */
  note?: ReactNode;
  /** Hide "Lent by …" (on your own listings it is always you). */
  hideOwner?: boolean;
};

/**
 * One listing. The category rides on a small manila tag, the same tag the public shelf uses,
 * so a tool looks like the labelled stock of a tool library.
 */
export function ToolCard({ tool, actions, note, hideOwner = false }: ToolCardProps) {
  return (
    <article className="flex h-full flex-col rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CategoryTag>{formatCategory(tool.category)}</CategoryTag>
        <Availability availability={tool.availability} />
      </div>

      <h3 className="mt-3 text-lg leading-snug font-semibold tracking-[-0.01em] break-words">{tool.name}</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">Condition: {formatCondition(tool.condition)}</p>
      <p className="mt-2 line-clamp-3 text-sm leading-relaxed break-words whitespace-pre-line">{tool.description}</p>
      {note ? <div className="mt-3">{note}</div> : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-4">
        {hideOwner ? (
          <span />
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="truncate text-muted-foreground">
              {tool.isMine ? "Your listing" : <>Lent by <span className="font-medium text-foreground">{firstName(tool.owner.name)}</span></>}
            </span>
            {tool.owner.trustedLender ? <TrustedBadge /> : null}
          </div>
        )}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
    </article>
  );
}

function CategoryTag({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-flex h-6 items-center rounded-r-sm bg-tag pr-2.5 pl-5 text-xs font-medium text-tag-foreground [clip-path:polygon(7px_0,100%_0,100%_100%,7px_100%,0_calc(100%-7px),0_7px)]">
      <span aria-hidden="true" className="absolute top-1/2 left-2 size-1.5 -translate-y-1/2 rounded-full bg-card" />
      {children}
    </span>
  );
}

function Availability({ availability }: { availability: ToolView["availability"] }) {
  if (availability.state === "on_loan") {
    return (
      <span className="inline-flex h-6 items-center rounded-full bg-warning px-2.5 text-xs font-medium text-warning-foreground">
        On loan until {formatIsoDate(availability.until)}
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 items-center gap-1.5 text-xs font-medium text-success-foreground">
      <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
      Available
    </span>
  );
}

/** Placeholder grid in the same shape as the cards. */
export function ToolGridSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(TOOL_GRID, className)} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-52 flex-col rounded-xl border bg-card p-4">
          <div className="flex justify-between">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-16" />
          </div>
          <Skeleton className="mt-4 h-5 w-3/5" />
          <Skeleton className="mt-2 h-4 w-1/3" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-4/5" />
          <div className="mt-auto flex justify-between">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export const TOOL_GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
