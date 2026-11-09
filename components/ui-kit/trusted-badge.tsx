import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Marks a lender an admin has vouched for. Show it to signed-in users only, next to the
 * lender's name (never on the public page).
 */
export function TrustedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-primary/30 text-primary", className)}>
      <ShieldCheck data-icon="inline-start" aria-hidden="true" />
      Trusted Lender
    </Badge>
  );
}
