"use client";

import type { FunctionReturnType } from "convex/server";
import { formatDistanceToNow } from "date-fns";
import { CircleCheck } from "lucide-react";
import { DataCard, ResponsiveData, TableSkeleton, When } from "@/components/admin/admin-shared";
import { eventLabel } from "@/components/loan-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui-kit/empty-state";
import type { UseQueryResult } from "convex/react";
import type { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";

type Health = FunctionReturnType<typeof api.automation.adminHealth>;

function ago(at: number) {
  return formatDistanceToNow(at, { addSuffix: true });
}

/** What failed in the email automation and needs a person: undelivered events and n8n errors. */
export function AutomationHealth({ result }: { result: UseQueryResult<Health> }) {
  if (result.status === "pending") return <TableSkeleton />;
  if (result.status === "error") return <p className="text-sm text-destructive">{errorMessage(result.error)}</p>;
  const { failedDeliveries, workflowErrors } = result.data;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="failed-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="failed-heading" className="text-lg font-semibold tracking-tight">
            Undelivered loan events
          </h2>
          <p className="text-sm text-muted-foreground">
            Events the app gave up sending to n8n after 6 attempts, so no email went out for them. Latest 50.
          </p>
        </div>
        {failedDeliveries.length === 0 ? (
          <EmptyState icon={CircleCheck} title="All events delivered" description="Every loan event reached n8n." />
        ) : (
          <ResponsiveData
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Event</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead>Last error</TableHead>
                    <TableHead className="pr-4">Happened</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failedDeliveries.map((d) => (
                    <TableRow key={d.eventId}>
                      <TableCell className="pl-4">
                        <span className="font-medium">{eventLabel(d.type)}</span>
                        <span className="block font-mono text-xs text-muted-foreground" title={d.eventId}>
                          {d.eventId.slice(0, 8)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.attempts}</TableCell>
                      <TableCell className="max-w-80 whitespace-normal break-words text-destructive">
                        {d.lastError ?? "Unknown"}
                      </TableCell>
                      <TableCell className="pr-4 text-muted-foreground">
                        <When at={d.at}>{ago(d.at)}</When>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
            cards={failedDeliveries.map((d) => (
              <DataCard key={d.eventId}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold">{eventLabel(d.type)}</p>
                  <p className="shrink-0 text-sm text-muted-foreground">
                    <When at={d.at}>{ago(d.at)}</When>
                  </p>
                </div>
                <p className="text-sm break-words text-destructive">{d.lastError ?? "Unknown error"}</p>
                <p className="text-sm text-muted-foreground">
                  {d.attempts} attempts, event <span className="font-mono text-xs">{d.eventId.slice(0, 8)}</span>
                </p>
              </DataCard>
            ))}
          />
        )}
      </section>

      <section aria-labelledby="errors-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="errors-heading" className="text-lg font-semibold tracking-tight">
            Workflow errors
          </h2>
          <p className="text-sm text-muted-foreground">Failed n8n runs reported by its error workflow. Latest 50.</p>
        </div>
        {workflowErrors.length === 0 ? (
          <EmptyState icon={CircleCheck} title="No workflow errors" description="Every n8n run finished." />
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {workflowErrors.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex flex-col gap-1 p-4 md:flex-row md:items-baseline md:gap-6">
                <p className="min-w-0 flex-1 text-sm break-words">{e.detail}</p>
                <p className="shrink-0 text-sm text-muted-foreground">
                  <When at={e.at}>{ago(e.at)}</When>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
