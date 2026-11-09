import { cn } from "@/lib/utils";

/**
 * Two linked rings: a tool goes out and comes back. The green ring's lower crossing is
 * redrawn on top so the rings read as interlocked rather than stacked.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("size-6", className)}>
      <circle cx="9" cy="12" r="6" stroke="var(--primary)" strokeWidth="2.5" />
      <circle cx="15" cy="12" r="6" stroke="currentColor" strokeWidth="2.5" />
      <path d="M13.6 15.86A6 6 0 0 1 10.04 17.91" stroke="var(--primary)" strokeWidth="2.5" />
    </svg>
  );
}

/** The "LendLoop" wordmark. Use `size="lg"` on the public page. */
export function Logo({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-heading font-bold tracking-[-0.03em] text-foreground",
        size === "lg" ? "text-2xl" : "text-lg",
        className,
      )}
    >
      <LogoMark className={size === "lg" ? "size-7" : "size-6"} />
      LendLoop
    </span>
  );
}
