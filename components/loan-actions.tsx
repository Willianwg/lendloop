"use client";

import { useMutation } from "convex/react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ACTIONS, sortActions } from "@/components/loan-view";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { LoanAction } from "@/convex/lib/loans";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type LoanActionsProps = {
  loanId: Id<"loans">;
  /** The server's `allowedActions` for this viewer: nothing else is ever rendered. */
  actions: LoanAction[];
  /** The other party's name, for the confirmation copy. */
  counterpartName: string;
  size?: "default" | "lg";
  className?: string;
};

/** The buttons for the loan actions the viewer may take now. Destructive ones confirm first. */
export function LoanActions({ loanId, actions, counterpartName, size = "default", className }: LoanActionsProps) {
  const transition = useMutation(api.loans.transition);
  const [busy, setBusy] = useState<LoanAction | null>(null);

  if (actions.length === 0) return null;

  async function run(action: LoanAction) {
    setBusy(action);
    try {
      await transition({ loanId, action });
      toast.success(ACTIONS[action].done);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {sortActions(actions).map((action) => {
        const meta = ACTIONS[action];
        const button = (
          <Button
            variant={meta.variant}
            size={size}
            disabled={busy !== null}
            aria-busy={busy === action}
            onClick={meta.confirm ? undefined : () => void run(action)}
          >
            {busy === action ? `${meta.label}…` : meta.label}
          </Button>
        );
        if (!meta.confirm) return <Fragment key={action}>{button}</Fragment>;
        return (
          <AlertDialog key={action}>
            <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{meta.confirm.title}</AlertDialogTitle>
                <AlertDialogDescription>{meta.confirm.body.replace("{name}", counterpartName)}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{meta.confirm.cancel}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void run(action)}>
                  {meta.label}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      })}
    </div>
  );
}
