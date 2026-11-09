import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  /** A lucide icon component, e.g. `icon={Inbox}`. */
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Usually one `<Button>` (or `<Button asChild><Link/></Button>`) that resolves the emptiness. */
  action?: ReactNode;
  className?: string;
};

/** What a list shows when it has nothing in it: what's missing, and the one action that fixes it. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      ) : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
