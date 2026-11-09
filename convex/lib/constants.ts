// Domain vocabulary shared by Convex functions and the Next.js app.
import { v } from "convex/values";

export const CATEGORIES = [
  { value: "power_tools", label: "Power tools" },
  { value: "hand_tools", label: "Hand tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "cleaning", label: "Cleaning" },
  { value: "other", label: "Other" },
] as const;
export type Category = (typeof CATEGORIES)[number]["value"];
export const CATEGORY_VALUES = CATEGORIES.map((c) => c.value) as unknown as readonly Category[];

export const CONDITIONS = [
  { value: "new", label: "New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "worn", label: "Worn" },
] as const;
export type Condition = (typeof CONDITIONS)[number]["value"];

export const LOAN_STATUSES = ["pending", "approved", "return_claimed", "returned", "declined", "cancelled"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const EVENT_TYPES = [
  "loan.requested",
  "loan.approved",
  "loan.declined",
  "loan.cancelled",
  "loan.return_claimed",
  "loan.returned",
  "loan.return_disputed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const AUTOMATION_EVENT_KINDS = [
  "notification_sent",
  "notification_failed",
  "delivery_failed",
  "reminder_sent",
  "reminder_failed",
  "workflow_error",
] as const;
export type AutomationEventKind = (typeof AUTOMATION_EVENT_KINDS)[number];

export const MAX_LOAN_DAYS = 30;
export const TOOL_NAME_MAX = 80;
export const TOOL_DESCRIPTION_MAX = 280;
export const REMOVAL_REASON_MIN = 3;
export const REMOVAL_REASON_MAX = 200;

export const vCategory = v.union(
  v.literal("power_tools"),
  v.literal("hand_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);
export const vCondition = v.union(v.literal("new"), v.literal("good"), v.literal("fair"), v.literal("worn"));
export const vLoanStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("return_claimed"),
  v.literal("returned"),
  v.literal("declined"),
  v.literal("cancelled"),
);
export const vEventType = v.union(
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.cancelled"),
  v.literal("loan.return_claimed"),
  v.literal("loan.returned"),
  v.literal("loan.return_disputed"),
);
export const vAutomationEventKind = v.union(
  v.literal("notification_sent"),
  v.literal("notification_failed"),
  v.literal("delivery_failed"),
  v.literal("reminder_sent"),
  v.literal("reminder_failed"),
  v.literal("workflow_error"),
);
export const vRole = v.union(v.literal("user"), v.literal("admin"));

/**
 * Outbox delays between delivery attempts: the initial try plus one retry per entry
 * (30 s, 2 min, 10 min, 30 min, 2 h). After the last retry fails the delivery is `failed`.
 */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000] as const;
