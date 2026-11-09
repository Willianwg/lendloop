import Link from "next/link";
import { CATEGORIES, type Category } from "@/convex/lib/constants";
import { cn } from "@/lib/utils";

/** Reads `?category=` and drops anything that isn't a known category (then it means "All"). */
export function parseCategory(value: string | null | undefined): Category | undefined {
  return CATEGORIES.find((c) => c.value === value)?.value;
}

const OPTIONS: { value: Category | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  ...CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
];

/**
 * Category chips that live in the URL (`/tools?category=garden`), so a filtered view can be
 * shared and survives a reload. One row that scrolls sideways on phones, wrapping from `md` up.
 */
export function CategoryFilter({ active }: { active: Category | undefined }) {
  return (
    <nav aria-label="Filter by category" className="-mx-4 md:mx-0">
      <ul className="flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
        {OPTIONS.map(({ value, label }) => {
          const current = value === active;
          return (
            <li key={label} className="shrink-0 snap-start">
              <Link
                href={value ? `/tools?category=${value}` : "/tools"}
                scroll={false}
                replace
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  current
                    ? "border-foreground bg-foreground text-background"
                    : "bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
