import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { getViewer, requireAdmin } from "./lib/auth";
import { fail } from "./lib/errors";

/**
 * Upserts the signed-in user from the verified Clerk token. Called by the app after sign-in.
 * Requires the `email` and `name` claims added in Clerk → Sessions → Customize session token.
 */
export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("UNAUTHENTICATED", "Sign in to continue.");
    const email = identity.email?.trim().toLowerCase();
    if (!email) {
      fail("INVALID", "Clerk session token is missing the email claim. See README → Clerk setup.");
    }
    const name = identity.name?.trim() || email.split("@")[0];
    const now = Date.now();

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (existing) {
      if (existing.email !== email || existing.name !== name) {
        await ctx.db.patch(existing._id, { email, name, updatedAt: now });
      }
      return existing._id;
    }
    return ctx.db.insert("users", {
      clerkId: identity.subject,
      email,
      name,
      role: "user",
      trustedLender: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** The viewer's own profile (their own email included), or null when signed out / not yet synced. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return {
      _id: viewer._id,
      name: viewer.name,
      email: viewer.email,
      role: viewer.role,
      trustedLender: viewer.trustedLender,
    };
  },
});

/** Admin view of users. Deliberately omits email: the admin workflows don't need it. */
export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return Promise.all(
      users.map(async (u) => {
        const tools = await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", u._id))
          .collect();
        return {
          _id: u._id,
          name: u.name,
          role: u.role,
          trustedLender: u.trustedLender,
          activeListings: tools.filter((tool) => tool.status === "active").length,
        };
      }),
    );
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const admin = await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) fail("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted, updatedAt: Date.now() });
    await writeAudit(ctx, {
      actorId: admin._id,
      action: "user.trusted_set",
      targetType: "user",
      targetId: userId,
      metadata: { trusted: String(trusted) },
    });
  },
});

/**
 * The only way to grant admin. Internal: callable from the CLI with the deployment admin key
 * (`npx convex run users:promoteToAdmin '{"email":"..."}'`), never from the app.
 */
export const promoteToAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();
    if (!user) fail("NOT_FOUND", `No user with email ${email}. Sign in once first.`);
    await ctx.db.patch(user._id, { role: "admin", updatedAt: Date.now() });
    await writeAudit(ctx, { actorId: null, action: "user.promoted", targetType: "user", targetId: user._id });
  },
});
