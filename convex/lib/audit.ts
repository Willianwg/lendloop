import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function writeAudit(
  ctx: MutationCtx,
  entry: {
    actorId: Id<"users"> | null;
    action: string;
    targetType: "tool" | "user" | "loan";
    targetId: string;
    metadata?: Record<string, string>;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", { ...entry, at: Date.now() });
}
