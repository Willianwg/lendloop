import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Listings } from "./listings";

export const metadata: Metadata = { title: "Your listings" };

export default function ListingsPage() {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.03em] md:text-3xl">Your listings</h1>
          <p className="mt-1 text-muted-foreground">The tools you lend out.</p>
        </div>
        <Button asChild size="lg" className="h-10 shrink-0 px-3.5">
          <Link href="/tools/new">
            <Plus data-icon="inline-start" aria-hidden="true" />
            List a tool
          </Link>
        </Button>
      </div>
      <Listings />
    </div>
  );
}
