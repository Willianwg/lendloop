import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vAutomationEventKind, vCategory, vCondition, vEventType, vLoanStatus, vRole } from "./lib/constants";

// Timestamps are epoch ms. Loan dates are UTC calendar dates as "YYYY-MM-DD".
export default defineSchema({
  users: defineTable({
    clerkId: v.string(), // Clerk token `subject`
    name: v.string(),
    // Stored for one purpose only: transactional notifications and reminders.
    // Never returned to other users except the loan counterpart after approval.
    email: v.string(),
    role: vRole,
    trustedLender: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
    status: v.union(v.literal("active"), v.literal("removed")),
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
    removedReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_status_category", ["status", "category"]),

  // A borrow request and the loan it becomes are the same record.
  loans: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    lenderId: v.id("users"), // denormalized from the tool for indexed "incoming" queries
    startDate: v.string(),
    endDate: v.string(),
    status: vLoanStatus,
    decidedAt: v.optional(v.number()),
    returnClaimedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_tool_borrower_status", ["toolId", "borrowerId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status_endDate", ["status", "endDate"]),

  // Transactional outbox for Convex -> n8n loan events. The payload is built at send time.
  webhookDeliveries: defineTable({
    eventId: v.string(),
    loanId: v.id("loans"),
    type: vEventType,
    recipientId: v.id("users"),
    actorId: v.optional(v.id("users")),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()), // n8n de-duplication lease
    notifyStatus: v.optional(v.union(v.literal("sent"), v.literal("failed"))), // n8n write-back
    processedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_status", ["status"])
    .index("by_loan", ["loanId"]),

  reminders: defineTable({
    reminderKey: v.string(), // `${loanId}:${YYYY-MM-DD}`
    loanId: v.id("loans"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    n8nExecutionId: v.optional(v.string()),
    recordedAt: v.number(),
  })
    .index("by_key", ["reminderKey"])
    .index("by_loan", ["loanId"]),

  // Feeds the per-loan activity timeline and the admin automation panel. No PII in `detail`.
  automationEvents: defineTable({
    loanId: v.optional(v.id("loans")),
    kind: vAutomationEventKind,
    detail: v.string(),
    externalId: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_loan", ["loanId"])
    .index("by_kind", ["kind"])
    .index("by_externalId", ["externalId"]),

  auditLog: defineTable({
    actorId: v.union(v.id("users"), v.null()), // null = CLI / system
    action: v.string(),
    targetType: v.union(v.literal("tool"), v.literal("user"), v.literal("loan")),
    targetId: v.string(),
    metadata: v.optional(v.record(v.string(), v.string())),
    at: v.number(),
  }).index("by_target", ["targetType", "targetId"]),
});
