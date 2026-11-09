"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CircleAlert, Inbox, Package, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { TOOL_GRID, ToolCard, ToolGridSkeleton } from "@/components/tool-card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { api } from "@/convex/_generated/api";
import { errorCode, errorMessage } from "@/lib/errors";
import { useViewerReady } from "../../tools/_lib/use-viewer-ready";

type Listing = FunctionReturnType<typeof api.tools.mine>[number];

export function Listings() {
  const ready = useViewerReady();
  const tools = useQuery(api.tools.mine, ready ? {} : "skip");

  if (tools === undefined) return <ToolGridSkeleton count={3} className="mt-6" />;
  if (tools.length === 0) {
    return (
      <EmptyState
        icon={Package}
        className="mt-6"
        title="You haven't listed anything yet"
        description="List a tool you don't use every day. Neighbors ask for dates, and you approve or decline."
        action={
          <Button asChild size="lg" className="h-10 px-4">
            <Link href="/tools/new">List a tool</Link>
          </Button>
        }
      />
    );
  }

  const waiting = tools.reduce((sum, t) => sum + t.pendingRequests, 0);
  return (
    <section aria-label="Your tools" className="mt-6">
      <p className="mb-3 text-sm text-muted-foreground">
        {tools.length} {tools.length === 1 ? "tool" : "tools"} listed
        {waiting > 0 ? `, ${waiting} ${waiting === 1 ? "request" : "requests"} waiting for you` : ""}
      </p>
      <ul className={TOOL_GRID}>
        {tools.map((tool) => (
          <li key={tool._id}>
            <ToolCard
              tool={tool}
              hideOwner
              note={<PendingNote count={tool.pendingRequests} />}
              actions={
                <>
                  <Button asChild variant="outline" size="lg" className="px-3">
                    <Link href={`/tools/${tool._id}/edit`}>
                      <Pencil data-icon="inline-start" aria-hidden="true" />
                      Edit
                    </Link>
                  </Button>
                  <DeleteListing tool={tool} />
                </>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PendingNote({ count }: { count: number }) {
  if (count === 0) return <p className="text-sm text-muted-foreground">No requests waiting</p>;
  return (
    <Link
      href="/me/incoming"
      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-info px-2.5 text-sm font-medium text-info-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Inbox className="size-3.5" aria-hidden="true" />
      {count} {count === 1 ? "request" : "requests"} waiting
    </Link>
  );
}

/**
 * Delete behind a confirmation. The server refuses while the tool is lent out (CONFLICT);
 * the dialog then stays open and says so, since the card may still read "Available" when
 * the approved loan starts later.
 */
function DeleteListing({ tool }: { tool: Listing }) {
  const remove = useMutation(api.tools.remove);
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    setDeleting(true);
    try {
      await remove({ toolId: tool._id });
      setOpen(false);
      toast.success("Listing deleted", { description: `${tool.name} is off the shelf.` });
    } catch (e) {
      if (errorCode(e) === "CONFLICT") setBlocked(true);
      else toast.error(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setBlocked(false);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="lg" className="px-3">
          <Trash2 data-icon="inline-start" aria-hidden="true" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">Delete {tool.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            It disappears from Browse. Any pending requests for it are cancelled, and those neighbors get an email.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {blocked ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-warning p-3 text-sm text-warning-foreground">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">This tool has an approved loan</p>
              <p className="mt-0.5">
                Delete it once it&apos;s back and marked returned. If the loan hasn&apos;t started, you can cancel it from
                Incoming first.
              </p>
            </div>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? "Close" : "Keep listing"}</AlertDialogCancel>
          {blocked ? null : (
            // A plain Button, not AlertDialogAction: Action closes the dialog before the result is known.
            <Button variant="destructive" disabled={deleting} onClick={confirm}>
              {deleting ? "Deleting…" : "Delete listing"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
