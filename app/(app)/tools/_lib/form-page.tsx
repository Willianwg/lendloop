import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** The frame shared by /tools/new and /tools/[id]/edit: back link, title, a narrow column. */
export function FormPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl">
      <Link
        href="/me/listings"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Your listings
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-[-0.03em] md:text-3xl">{title}</h1>
      <p className="mt-1 text-muted-foreground">{description}</p>
      <div className="mt-6 rounded-xl border bg-card p-4 md:p-6">{children}</div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="grid gap-6" aria-hidden="true">
      {[11, 11, 11, 28].map((h, i) => (
        <div key={i} className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="w-full" style={{ height: `${h * 0.25}rem` }} />
        </div>
      ))}
      <Skeleton className="ml-auto h-10 w-32" />
    </div>
  );
}
