"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Inbox, type LucideIcon, Package, Search, Send, Shield } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { Logo } from "@/components/brand";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: LucideIcon };

const TABS: Tab[] = [
  { href: "/tools", label: "Browse", icon: Search },
  { href: "/me/listings", label: "Listings", icon: Package },
  { href: "/me/requests", label: "Requests", icon: Send },
  { href: "/me/incoming", label: "Incoming", icon: Inbox },
];
const ADMIN_TAB: Tab = { href: "/admin", label: "Admin", icon: Shield };

function isActive(pathname: string | null, href: string) {
  return pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
}

function useTabs(): Tab[] {
  // The admin tab is a convenience only; /admin is enforced by Convex (FORBIDDEN for non-admins).
  const me = useQuery(api.users.me);
  return me?.role === "admin" ? [...TABS, ADMIN_TAB] : TABS;
}

function TopLinks({ pathname }: { pathname: string | null }) {
  const tabs = useTabs();
  return (
    <ul className="flex items-center gap-1">
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active &&
                  "text-foreground after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-primary",
              )}
            >
              {tab.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function BottomTabs({ pathname }: { pathname: string | null }) {
  const tabs = useTabs();
  return (
    <ul className="flex">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground focus-visible:bg-accent focus-visible:outline-none",
                active && "text-primary",
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden="true" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// usePathname suspends on routes with request-time params (e.g. /loans/[id]) under Cache
// Components, so each nav reads it behind its own Suspense boundary with an inactive fallback.
function ActiveTopLinks() {
  return <TopLinks pathname={usePathname()} />;
}
function ActiveBottomTabs() {
  return <BottomTabs pathname={usePathname()} />;
}

/**
 * The signed-in frame: top nav from `md` up, a bottom tab bar below it.
 * Tabs: Browse, Listings, Requests, Incoming, and Admin for admins.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-4">
          <Link href="/tools" className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <Logo />
            <span className="sr-only">, go to Browse</span>
          </Link>
          <nav aria-label="Main" className="hidden md:block">
            <Suspense fallback={<TopLinks pathname={null} />}>
              <ActiveTopLinks />
            </Suspense>
          </nav>
          <div className="ml-auto flex size-8 items-center justify-center">
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pt-8 md:pb-16">
        {children}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <Suspense fallback={<BottomTabs pathname={null} />}>
          <ActiveBottomTabs />
        </Suspense>
      </nav>
    </div>
  );
}
