"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AutomationHealth } from "@/components/admin/automation-health";
import { TableSkeleton } from "@/components/admin/admin-shared";
import { ListingsTable } from "@/components/admin/listings-table";
import { LoansTable } from "@/components/admin/loans-table";
import { UsersTable } from "@/components/admin/users-table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { useAuthedQuery } from "@/components/use-authed-query";
import { api } from "@/convex/_generated/api";
import { errorCode, errorMessage } from "@/lib/errors";

const TABS = ["loans", "users", "listings", "automation"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return (TABS as readonly string[]).includes(value ?? "");
}

/**
 * The admin console. Access is decided by the server: the users query throws FORBIDDEN for
 * anyone who isn't an admin, and that is what turns into "You don't have access".
 */
export function AdminConsole() {
  const users = useAuthedQuery(api.users.adminList, {});
  const health = useAuthedQuery(api.automation.adminHealth, {});
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = isTab(params.get("tab")) ? (params.get("tab") as Tab) : "loans";

  if (users.status === "error") {
    if (errorCode(users.error) === "FORBIDDEN") return <AccessDenied />;
    return <p className="text-sm text-destructive">{errorMessage(users.error)}</p>;
  }

  const problems =
    health.status === "success" ? health.data.failedDeliveries.length + health.data.workflowErrors.length : 0;

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Admin</h1>
        <p className="mt-1 text-muted-foreground">Loans, people, listings and email automation across the board.</p>
      </header>
      {users.status === "pending" ? (
        <TableSkeleton />
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => router.replace(`${pathname}?tab=${value}`, { scroll: false })}
          className="gap-5"
        >
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <TabsList className="h-9 w-max">
              <TabsTrigger value="loans" className="px-3">
                Loans
              </TabsTrigger>
              <TabsTrigger value="users" className="px-3">
                Users
              </TabsTrigger>
              <TabsTrigger value="listings" className="px-3">
                Listings
              </TabsTrigger>
              <TabsTrigger value="automation" className="px-3">
                Automation
                {problems > 0 ? (
                  <span className="ml-0.5 rounded-full bg-destructive/10 px-1.5 text-xs text-destructive tabular-nums">
                    {problems}
                    <span className="sr-only"> problems</span>
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="loans">
            <LoansTable />
          </TabsContent>
          <TabsContent value="users">
            <UsersTable users={users.data} />
          </TabsContent>
          <TabsContent value="listings">
            <ListingsTable />
          </TabsContent>
          <TabsContent value="automation">
            <AutomationHealth result={health} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function AccessDenied() {
  return (
    <EmptyState
      icon={Lock}
      title="You don't have access"
      description="This page is for LendLoop admins. If you think you should have access, ask an admin."
      action={
        <Button asChild variant="outline">
          <Link href="/tools">Back to Browse</Link>
        </Button>
      }
    />
  );
}

export function AdminSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6 h-9 w-32 animate-pulse rounded-md bg-muted" />
      <TableSkeleton />
    </div>
  );
}
