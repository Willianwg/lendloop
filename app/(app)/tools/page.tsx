import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ToolGridSkeleton } from "@/components/tool-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToolsBrowser } from "./tools-browser";

export const metadata: Metadata = { title: "Browse tools" };

export default function ToolsPage() {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.03em] md:text-3xl">Browse tools</h1>
          <p className="mt-1 text-muted-foreground">What your neighbors can lend you.</p>
        </div>
        <Button asChild size="lg" className="h-10 shrink-0 px-3.5">
          <Link href="/tools/new">
            <Plus data-icon="inline-start" aria-hidden="true" />
            List a tool
          </Link>
        </Button>
      </div>
      {/* The filter reads ?category=, which is only known at request time. */}
      <Suspense fallback={<BrowserSkeleton />}>
        <ToolsBrowser />
      </Suspense>
    </div>
  );
}

function BrowserSkeleton() {
  return (
    <div className="mt-6">
      <div className="flex gap-2 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <ToolGridSkeleton className="mt-8" />
    </div>
  );
}
