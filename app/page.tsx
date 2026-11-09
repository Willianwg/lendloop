import { fetchQuery } from "convex/nextjs";
import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { Logo } from "@/components/brand";
import { LandingCta } from "@/components/landing-cta";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { api } from "@/convex/_generated/api";
import { formatCategory } from "@/lib/format";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-16">
      <header className="flex h-16 items-center">
        <Logo size="lg" />
      </header>

      <main>
        <section className="pt-10 pb-12 md:pt-20 md:pb-16">
          <h1 className="max-w-[16ch] text-[2.75rem] leading-[1.02] font-bold tracking-[-0.035em] md:max-w-none md:text-7xl">
            <span className="block">Borrow what you need.</span>
            <span className="block">Lend what you don&apos;t.</span>
          </h1>
          <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
            A shared shelf for your street. List the drill you use twice a year, borrow the ladder you need once,
            and get a nudge when it&apos;s time to give it back.
          </p>
          <div className="mt-8">
            <LandingCta />
          </div>
        </section>

        <section aria-labelledby="shelf-heading">
          <h2 id="shelf-heading" className="mb-5 text-xl font-semibold tracking-tight">
            On the shelf now
          </h2>
          <Suspense fallback={<ShelfSkeleton />}>
            <Shelf />
          </Suspense>
        </section>
      </main>
    </div>
  );
}

type PublicTool = { _id: string; name: string; category: string };

/**
 * The public list, cached on the server and refreshed in the background every 30 s
 * (the Cache Components equivalent of `revalidate = 30`). If Convex is unreachable the
 * failure is cached for seconds only, which also keeps `next build` working without Convex.
 */
async function Shelf() {
  "use cache";
  let tools: PublicTool[];
  try {
    tools = await fetchQuery(api.tools.listPublic, {});
    cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  } catch {
    cacheLife("seconds");
    return <p className="text-muted-foreground">The shelf can&apos;t be loaded right now. Refresh in a moment.</p>;
  }

  if (tools.length === 0) {
    return (
      <EmptyState
        title="The shelf is empty"
        description="Nobody has listed a tool yet. Sign in and put the first one up."
      />
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tools.map((tool) => (
        <li key={tool._id}>
          <ToolTag name={tool.name} category={formatCategory(tool.category)} />
        </li>
      ))}
    </ul>
  );
}

/** A manila tool tag: notched left edge with a punched hole, the way a tool library labels its stock. */
function ToolTag({ name, category }: { name: string; category: string }) {
  return (
    <div className="tool-tag relative flex h-full min-h-20 flex-col justify-center gap-1 bg-tag py-3 pr-3 pl-9 text-tag-foreground">
      <span aria-hidden="true" className="absolute top-1/2 left-3.5 size-2.5 -translate-y-1/2 rounded-full bg-background ring-1 ring-tag-foreground/25" />
      <span className="line-clamp-2 leading-snug font-semibold break-words">{name}</span>
      <span className="text-sm text-tag-foreground/70">{category}</span>
    </div>
  );
}

function ShelfSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-20 rounded-md" />
      ))}
    </div>
  );
}
