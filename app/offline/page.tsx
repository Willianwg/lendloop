import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { Logo } from "@/components/brand";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "Offline" };

// Static and public: the service worker precaches it and serves it when a page can't load.
export default function OfflinePage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4">
      <header className="flex h-16 items-center">
        <Logo />
      </header>
      <main className="flex flex-1 flex-col justify-center pb-24">
        <WifiOff className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
        <p className="mt-2 text-muted-foreground">
          LendLoop needs a connection to show tools and loans. Check your connection, then try again.
        </p>
        <div className="mt-6">
          <RetryButton />
        </div>
      </main>
    </div>
  );
}
