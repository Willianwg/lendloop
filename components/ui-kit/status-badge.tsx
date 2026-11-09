import { Badge } from "@/components/ui/badge";
import type { LoanStatus } from "@/convex/lib/constants";
import { cn } from "@/lib/utils";

const STATUS: Record<LoanStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-warning text-warning-foreground" },
  approved: { label: "Approved", className: "bg-success text-success-foreground" },
  return_claimed: { label: "Return claimed", className: "bg-info text-info-foreground" },
  returned: { label: "Returned", className: "bg-muted text-muted-foreground" },
  declined: { label: "Declined", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

export type StatusBadgeProps = {
  status: LoanStatus;
  /** Days past the end date. When > 0 on an approved loan, the badge reads "Overdue N days" in red. */
  overdueDays?: number;
  className?: string;
};

/** A loan's status as a small colored pill. */
export function StatusBadge({ status, overdueDays = 0, className }: StatusBadgeProps) {
  if (status === "approved" && overdueDays > 0) {
    return (
      <Badge variant="destructive" className={className}>
        Overdue {overdueDays} {overdueDays === 1 ? "day" : "days"}
      </Badge>
    );
  }
  const { label, className: tone } = STATUS[status];
  return <Badge className={cn(tone, className)}>{label}</Badge>;
}
