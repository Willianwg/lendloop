"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { disabledDays, formatIsoDate, loanDates, MAX_LOAN_DAYS, type DateSelection } from "@/app/(app)/tools/_lib/dates";
import { firstName } from "@/app/(app)/tools/_lib/tool-input";
import type { ToolView } from "@/app/(app)/tools/_lib/use-viewer-ready";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";

const DESKTOP = "(min-width: 768px)";

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(DESKTOP);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}

/**
 * "Request" button plus the sheet where the borrower picks dates. Days before local today
 * can't be picked, and once a start is picked the calendar only offers days that keep the
 * loan within 30 days. Dates go out as local `YYYY-MM-DD`; the server allows for the UTC
 * offset. A bottom sheet on phones, a side sheet from `md` up.
 */
export function RequestSheet({ tool }: { tool: ToolView }) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const request = useMutation(api.loans.request);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<DateSelection>(undefined);
  const [today, setToday] = useState(() => new Date());
  const [sending, setSending] = useState(false);

  const lender = firstName(tool.owner.name);
  const dates = loanDates(selection, today);
  const ready = !("error" in dates);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // A sheet left open past midnight would offer yesterday; take "today" when it opens.
      setToday(new Date());
      setSelection(undefined);
    }
  }

  async function send() {
    if (!ready || sending) return;
    setSending(true);
    try {
      await request({ toolId: tool._id, startDate: dates.startDate, endDate: dates.endDate });
      setOpen(false);
      toast.success("Request sent", {
        description: `${lender} will get an email to approve or decline it.`,
        action: { label: "View", onClick: () => router.push("/me/requests") },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button size="lg" className="px-4">
          Request
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className="gap-0 overflow-y-auto data-[side=bottom]:max-h-[92dvh] data-[side=bottom]:rounded-t-2xl data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="text-lg font-semibold">Borrow {tool.name}</SheetTitle>
          <SheetDescription>
            Pick the days you need it, up to {MAX_LOAN_DAYS}. {lender} gets your request and decides.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4">
          {tool.availability.state === "on_loan" ? (
            <p className="mb-3 rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground">
              On loan until {formatIsoDate(tool.availability.until)}. Dates after that are the safest bet.
            </p>
          ) : null}
          <Calendar
            mode="range"
            selected={selection?.from ? { from: selection.from, to: selection.to } : undefined}
            onSelect={(range) => setSelection(range)}
            disabled={disabledDays(today, selection)}
            resetOnSelect
            today={today}
            defaultMonth={today}
            startMonth={today}
            className="mx-auto rounded-xl border p-3 [--cell-size:--spacing(10)] sm:[--cell-size:--spacing(10.5)]"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Tap the first day, then the last one.
          </p>
        </div>

        <SheetFooter className="mt-4 border-t pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div aria-live="polite" className="min-h-10 text-sm">
            {ready ? (
              <>
                <p className="font-medium">
                  {dates.startDate === dates.endDate
                    ? formatIsoDate(dates.startDate)
                    : `${formatIsoDate(dates.startDate)} to ${formatIsoDate(dates.endDate)}`}
                </p>
                <p className="text-muted-foreground">
                  {dates.days} {dates.days === 1 ? "day" : "days"}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">{dates.error}</p>
            )}
          </div>
          <Button size="lg" className="h-11 text-base" disabled={!ready || sending} onClick={send}>
            {sending ? "Sending…" : "Send request"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
