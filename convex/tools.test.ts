import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { insertUser, setup } from "./lib/test.helpers";

describe("tools.listPublic", () => {
  test("listPublic exposes only id, name, category", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    await t.run(async (ctx) => {
      const base = { ownerId: ana, condition: "good" as const, description: "x", createdAt: 1, updatedAt: 1 };
      await ctx.db.insert("tools", { ...base, name: "Drill", category: "power_tools", status: "active" });
      await ctx.db.insert("tools", { ...base, name: "Hidden", category: "garden", status: "removed", removedAt: 2 });
    });
    const rows = await t.query(api.tools.listPublic, {});
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["_id", "category", "name"]);
    expect(rows[0]).toMatchObject({ name: "Drill", category: "power_tools" });
  });
});
