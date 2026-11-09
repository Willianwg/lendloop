"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Package } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { DataCard, ResponsiveData, TableSkeleton } from "@/components/admin/admin-shared";
import { reasonError, reasonLength } from "@/components/admin/removal-reason";
import { formatDay, todayUtc } from "@/components/loan-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { TrustedBadge } from "@/components/ui-kit/trusted-badge";
import { useAuthedQuery } from "@/components/use-authed-query";
import { api } from "@/convex/_generated/api";
import { REMOVAL_REASON_MAX } from "@/convex/lib/constants";
import { errorMessage } from "@/lib/errors";
import { formatCategory } from "@/lib/format";

type Listing = FunctionReturnType<typeof api.tools.list>[number];

/** Every active listing, with moderation removal. */
export function ListingsTable() {
  const result = useAuthedQuery(api.tools.list, {});
  const today = todayUtc();

  if (result.status === "pending") return <TableSkeleton />;
  if (result.status === "error") return <p className="text-sm text-destructive">{errorMessage(result.error)}</p>;
  if (result.data.length === 0) {
    return <EmptyState icon={Package} title="No active listings" description="Tools people list show up here." />;
  }

  const tools = result.data;
  return (
    <ResponsiveData
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Tool</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead className="pr-4 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.map((tool) => (
              <TableRow key={tool._id}>
                <TableCell className="max-w-64 pl-4 font-medium whitespace-normal break-words">{tool.name}</TableCell>
                <TableCell>{formatCategory(tool.category)}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {tool.owner.name}
                    {tool.owner.trustedLender ? <TrustedBadge /> : null}
                  </span>
                </TableCell>
                <TableCell>
                  <Availability tool={tool} today={today} />
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <RemoveListing tool={tool} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      cards={tools.map((tool) => (
        <DataCard key={tool._id}>
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 font-semibold break-words">{tool.name}</p>
            <Availability tool={tool} today={today} />
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {formatCategory(tool.category)}, listed by {tool.owner.name}
            {tool.owner.trustedLender ? <TrustedBadge /> : null}
          </p>
          <div>
            <RemoveListing tool={tool} />
          </div>
        </DataCard>
      ))}
    />
  );
}

function Availability({ tool, today }: { tool: Listing; today: string }) {
  return tool.availability.state === "on_loan" ? (
    <Badge className="bg-info text-info-foreground">On loan until {formatDay(tool.availability.until, today)}</Badge>
  ) : (
    <span className="text-sm text-muted-foreground">Available</span>
  );
}

/** "Remove" plus the dialog that asks why. The reason is stored and audit-logged. */
function RemoveListing({ tool }: { tool: Listing }) {
  const adminRemove = useMutation(api.tools.adminRemove);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fieldId = useId();
  const clientError = reasonError(reason);
  const shownError = serverError ?? (touched ? clientError : null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setReason("");
      setTouched(false);
      setServerError(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (clientError) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await adminRemove({ toolId: tool._id, reason: reason.trim() });
      toast.success(`Removed "${tool.name}"`);
      onOpenChange(false);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent className="text-left sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="break-words">Remove &ldquo;{tool.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              It disappears from Browse and can&apos;t be requested. Pending requests are cancelled and those
              borrowers are told. A loan already in progress keeps running until the tool comes back.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={fieldId}>Reason</Label>
            <Textarea
              id={fieldId}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setServerError(null);
              }}
              onBlur={() => setTouched(true)}
              placeholder="For example: not a tool, or a duplicate listing"
              aria-invalid={shownError ? true : undefined}
              aria-describedby={`${fieldId}-hint`}
              maxLength={REMOVAL_REASON_MAX + 50}
              rows={3}
            />
            <div id={`${fieldId}-hint`} className="flex justify-between gap-3 text-sm">
              <span className={shownError ? "text-destructive" : "text-muted-foreground"} role={shownError ? "alert" : undefined}>
                {shownError ?? "Kept in the audit log."}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {reasonLength(reason)}/{REMOVAL_REASON_MAX}
              </span>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep listing
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={submitting}>
              {submitting ? "Removing…" : "Remove listing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
