import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { modules } from "./test.setup";

test("convex-test harness boots against the schema", async () => {
  const t = convexTest(schema, modules);
  expect(await t.run(async () => 1 + 1)).toBe(2);
});
