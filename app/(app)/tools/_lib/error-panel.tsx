"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { errorCode, errorMessage } from "@/lib/errors";

/**
 * Body of the tools and listings `error.tsx` boundaries: a Convex query threw (a malformed
 * link, or the backend is unreachable). App errors show their own message; anything else a
 * generic line, so internals never reach the page.
 */
export function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  const known = errorCode(error) !== null;
  return (
    <EmptyState
      icon={CircleAlert}
      title={known ? errorMessage(error) : "This page couldn't load"}
      description={known ? undefined : "The link may be broken, or the server is busy. Try again in a moment."}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" className="h-10 px-4" onClick={() => retry()}>
            Try again
          </Button>
          <Button asChild variant="outline" size="lg" className="h-10 px-4">
            <Link href="/tools">Browse tools</Link>
          </Button>
        </div>
      }
    />
  );
}
