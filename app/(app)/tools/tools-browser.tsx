"use client";

import { useQuery } from "convex/react";
import { PackageOpen } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CategoryFilter, parseCategory } from "@/components/category-filter";
import { RequestSheet } from "@/components/request-sheet";
import { TOOL_GRID, ToolCard, ToolGridSkeleton } from "@/components/tool-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { api } from "@/convex/_generated/api";
import { formatCategory } from "@/lib/format";
import { useViewerReady } from "./_lib/use-viewer-ready";

/** The filter chips and the grid of active tools for `?category=`. */
export function ToolsBrowser() {
  const category = parseCategory(useSearchParams().get("category"));
  const ready = useViewerReady();
  const tools = useQuery(api.tools.list, ready ? (category ? { category } : {}) : "skip");
  const newHref = category ? `/tools/new?category=${category}` : "/tools/new";

  return (
    <div className="mt-6">
      <CategoryFilter active={category} />

      <section aria-label="Tools" aria-busy={tools === undefined} className="mt-6">
        {tools === undefined ? (
          <ToolGridSkeleton />
        ) : tools.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title={category ? `No ${formatCategory(category).toLowerCase()} tools yet` : "Nothing on the shelf yet"}
            description={
              category
                ? "Nobody has listed one in this category. If you have one, you could be the first."
                : "Nobody has listed a tool yet. Put up the first one and your neighbors can borrow it."
            }
            action={
              <Button asChild size="lg" className="h-10 px-4">
                <Link href={newHref}>List a tool</Link>
              </Button>
            }
          />
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              {tools.length} {tools.length === 1 ? "tool" : "tools"}
              {category ? ` in ${formatCategory(category)}` : ""}
            </p>
            <ul className={TOOL_GRID}>
              {tools.map((tool) => (
                <li key={tool._id}>
                  <ToolCard tool={tool} actions={tool.isMine ? null : <RequestSheet tool={tool} />} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
