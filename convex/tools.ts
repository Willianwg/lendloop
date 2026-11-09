import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAdmin, requireUser } from "./lib/auth";
import {
  REMOVAL_REASON_MAX,
  REMOVAL_REASON_MIN,
  TOOL_DESCRIPTION_MAX,
  TOOL_NAME_MAX,
  vCategory,
  vCondition,
} from "./lib/constants";
import { todayUtc } from "./lib/dates";
import { fail } from "./lib/errors";
import { cancelPendingForTool } from "./lib/loanEffects";
import { activeLoansOfTool } from "./lib/loans";
import { cleanText } from "./lib/validate";

/**
 * Public, unauthenticated list for the landing page. Returns only id, name and category of
 * active tools: no owner, condition, description or availability.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status_category", (q) => q.eq("status", "active"))
      .collect();
    return tools
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((tool) => ({ _id: tool._id, name: tool.name, category: tool.category }));
  },
});

export type Availability = { state: "available" } | { state: "on_loan"; until: string };

/**
 * What a signed-in user sees about a tool. The owner appears by name and badge only:
 * no owner id, no email.
 */
async function toCard(ctx: QueryCtx, tool: Doc<"tools">, viewerId: Id<"users">, today: string) {
  const owner = await ctx.db.get(tool.ownerId);
  // "On loan" means an active loan covers today (spec §6). An overdue loan (endDate < today)
  // doesn't count: the card follows the agreed dates, and overdue handling is the reminders' job.
  const current = (await activeLoansOfTool(ctx, tool._id)).find(
    (loan) => loan.startDate <= today && today <= loan.endDate,
  );
  const availability: Availability = current ? { state: "on_loan", until: current.endDate } : { state: "available" };
  return {
    _id: tool._id,
    name: tool.name,
    category: tool.category,
    condition: tool.condition,
    description: tool.description,
    owner: { name: owner?.name ?? "Unknown", trustedLender: owner?.trustedLender ?? false },
    isMine: tool.ownerId === viewerId,
    availability,
  };
}

export type ToolCard = Awaited<ReturnType<typeof toCard>>;

/** All active tools, newest first, optionally filtered by category. */
export const list = query({
  args: { category: v.optional(vCategory) },
  handler: async (ctx, { category }) => {
    const viewer = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status_category", (q) =>
        category ? q.eq("status", "active").eq("category", category) : q.eq("status", "active"),
      )
      .collect();
    const today = todayUtc();
    tools.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(tools.map((tool) => toCard(ctx, tool, viewer._id, today)));
  },
});

/** One tool card, or null when the tool doesn't exist or was removed. */
export const get = query({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.status !== "active") return null;
    return toCard(ctx, tool, viewer._id, todayUtc());
  },
});

/** The viewer's active listings, with how many requests wait for a decision. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .collect();
    const today = todayUtc();
    const active = tools.filter((tool) => tool.status === "active").sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      active.map(async (tool) => {
        const pending = await ctx.db
          .query("loans")
          .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
          .collect();
        return { ...(await toCard(ctx, tool, viewer._id, today)), pendingRequests: pending.length };
      }),
    );
  },
});

const toolFields = {
  name: v.string(),
  category: vCategory,
  condition: vCondition,
  description: v.string(),
};

function cleanToolFields(a: { name: string; description: string }) {
  return {
    name: cleanText(a.name, "name", 1, TOOL_NAME_MAX),
    description: cleanText(a.description, "description", 1, TOOL_DESCRIPTION_MAX),
  };
}

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const now = Date.now();
    return ctx.db.insert("tools", {
      ownerId: viewer._id,
      category: args.category,
      condition: args.condition,
      ...cleanToolFields(args),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Loads an active tool the viewer owns. Admins get no exception here: editing and owner
 * deletion belong to the owner; admins moderate through `adminRemove`.
 */
async function requireOwnTool(ctx: MutationCtx, toolId: Id<"tools">, viewerId: Id<"users">) {
  const tool = await ctx.db.get(toolId);
  if (!tool) fail("NOT_FOUND", "Tool not found.");
  if (tool.ownerId !== viewerId) fail("FORBIDDEN", "Only the owner can change this listing.");
  if (tool.status !== "active") fail("NOT_FOUND", "This listing was removed.");
  return tool;
}

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const viewer = await requireUser(ctx);
    await requireOwnTool(ctx, toolId, viewer._id);
    await ctx.db.patch(toolId, {
      category: args.category,
      condition: args.condition,
      ...cleanToolFields(args),
      updatedAt: Date.now(),
    });
  },
});

/** Owner deletion: a soft delete, blocked while the tool is lent out. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireUser(ctx);
    await requireOwnTool(ctx, toolId, viewer._id);
    if ((await activeLoansOfTool(ctx, toolId)).length > 0) {
      fail("CONFLICT", "This tool is currently on loan. Delete it after it comes back.");
    }
    const now = Date.now();
    await ctx.db.patch(toolId, { status: "removed", removedAt: now, removedBy: viewer._id, updatedAt: now });
    await cancelPendingForTool(ctx, toolId);
  },
});

/**
 * Admin removal (moderation). Never blocked by an active loan: that loan keeps running to
 * completion (spec §7); the tool just disappears from listings and can't be requested.
 */
export const adminRemove = mutation({
  args: { toolId: v.id("tools"), reason: v.string() },
  handler: async (ctx, { toolId, reason }) => {
    const admin = await requireAdmin(ctx);
    const removedReason = cleanText(reason, "reason", REMOVAL_REASON_MIN, REMOVAL_REASON_MAX);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "Tool not found.");
    if (tool.status !== "active") fail("CONFLICT", "This listing is already removed.");
    const now = Date.now();
    await ctx.db.patch(toolId, {
      status: "removed",
      removedAt: now,
      removedBy: admin._id,
      removedReason,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      actorId: admin._id,
      action: "tool.removed",
      targetType: "tool",
      targetId: toolId,
      metadata: { reason: removedReason },
    });
    await cancelPendingForTool(ctx, toolId);
  },
});
