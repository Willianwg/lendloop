"use client";

import { AlarmClock, CircleAlert, Mail, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { AutomationEventKind } from "@/convex/lib/constants";
import { activityText } from "@/components/loan-view";
import { cn } from "@/lib/utils";

export type ActivityItem = { kind: AutomationEventKind; detail: string; at: number };

const ICONS: Record<AutomationEventKind, { icon: LucideIcon; failed: boolean }> = {
  notification_sent: { icon: Mail, failed: false },
  notification_failed: { icon: Mail, failed: true },
  delivery_failed: { icon: CircleAlert, failed: true },
  reminder_sent: { icon: AlarmClock, failed: false },
  reminder_failed: { icon: AlarmClock, failed: true },
  workflow_error: { icon: CircleAlert, failed: true },
};

const MINUTE = 60_000;

function subscribeMinutes(onChange: () => void) {
  const id = setInterval(onChange, MINUTE);
  return () => clearInterval(id);
}
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/** The current time, rounded to the minute and refreshed every minute, for relative times. */
export function useNow(): number {
  return useSyncExternalStore(subscribeMinutes, minuteNow, minuteNow);
}

/** One automation line, e.g. "Reminder sent 2 days ago". Used on loan cards. */
export function ActivityLine({ item, className }: { item: ActivityItem; className?: string }) {
  const now = useNow();
  const { icon: Icon, failed } = ICONS[item.kind] ?? ICONS.workflow_error;
  return (
    <p className={cn("flex items-start gap-1.5 text-sm text-muted-foreground", failed && "text-destructive", className)}>
      <Icon className="mt-[3px] size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <time dateTime={new Date(item.at).toISOString()} title={new Date(item.at).toLocaleString()}>
          {activityText(item.detail, item.at, now)}
        </time>
      </span>
    </p>
  );
}

/** The automation activity of a loan (emails sent, reminders), newest first. */
export function ActivityList({ items }: { items: ActivityItem[] }) {
  const now = useNow();
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing yet. Emails and reminders about this loan show up here as they go out.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, i) => {
        const { icon: Icon, failed } = ICONS[item.kind] ?? ICONS.workflow_error;
        return (
          <li key={`${item.at}-${i}`} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground",
                failed && "bg-destructive/10 text-destructive",
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <p className={cn("pt-1 text-sm", failed && "text-destructive")}>
              <time dateTime={new Date(item.at).toISOString()} title={new Date(item.at).toLocaleString()}>
                {activityText(item.detail, item.at, now)}
              </time>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
