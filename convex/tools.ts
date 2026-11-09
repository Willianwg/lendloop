import { query } from "./_generated/server";

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
