import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import { identity, insertUser, setup } from "./lib/test.helpers";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return e.data as { code: string; message: string };
    throw e;
  }
  throw new Error("expected the call to fail");
}

describe("users", () => {
  test("ensureCurrent creates then updates the user", async () => {
    const t = setup();
    const id1 = await t.withIdentity(identity("ana")).mutation(api.users.ensureCurrent, {});
    const id2 = await t
      .withIdentity(identity("ana", { name: "Ana Souza" }))
      .mutation(api.users.ensureCurrent, {});
    expect(id2).toEqual(id1);
    const rows = await t.run((ctx) => ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Ana Souza", email: "ana@example.test", role: "user", trustedLender: false });
  });

  test("ensureCurrent falls back to the email local part for the name", async () => {
    const t = setup();
    await t.withIdentity(identity("bia", { name: undefined })).mutation(api.users.ensureCurrent, {});
    const [row] = await t.run((ctx) => ctx.db.query("users").collect());
    expect(row.name).toBe("bia");
  });

  test("ensureCurrent rejects a token without email", async () => {
    const t = setup();
    const err = await errorOf(
      t.withIdentity(identity("ana", { email: undefined })).mutation(api.users.ensureCurrent, {}),
    );
    expect(err.code).toBe("INVALID");
    expect(err.message).toContain("README");
  });

  test("ensureCurrent requires authentication", async () => {
    const t = setup();
    const err = await errorOf(t.mutation(api.users.ensureCurrent, {}));
    expect(err.code).toBe("UNAUTHENTICATED");
  });

  test("me returns null when anonymous", async () => {
    const t = setup();
    expect(await t.query(api.users.me, {})).toBeNull();
  });

  test("me returns the viewer's own profile", async () => {
    const t = setup();
    await insertUser(t, "ana");
    const me = await t.withIdentity(identity("ana")).query(api.users.me, {});
    expect(me).toMatchObject({ name: "Ana", email: "ana@example.test", role: "user", trustedLender: false });
  });

  test("setTrustedLender is admin-only", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    await insertUser(t, "joao");
    await insertUser(t, "root", "admin");

    const err = await errorOf(
      t.withIdentity(identity("joao")).mutation(api.users.setTrustedLender, { userId: ana, trusted: true }),
    );
    expect(err.code).toBe("FORBIDDEN");

    await t.withIdentity(identity("root")).mutation(api.users.setTrustedLender, { userId: ana, trusted: true });
    const row = await t.run((ctx) => ctx.db.get(ana));
    expect(row?.trustedLender).toBe(true);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "user.trusted_set", targetType: "user", targetId: ana });
  });

  test("adminList is admin-only and never includes email", async () => {
    const t = setup();
    await insertUser(t, "ana");
    await insertUser(t, "root", "admin");
    const err = await errorOf(t.withIdentity(identity("ana")).query(api.users.adminList, {}));
    expect(err.code).toBe("FORBIDDEN");

    const rows = await t.withIdentity(identity("root")).query(api.users.adminList, {});
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["_id", "activeListings", "name", "role", "trustedLender"]);
    }
  });

  test("promoteToAdmin is internal and audited", async () => {
    const t = setup();
    const ana = await insertUser(t, "ana");
    await t.mutation(internal.users.promoteToAdmin, { email: "ana@example.test" });
    expect((await t.run((ctx) => ctx.db.get(ana)))?.role).toBe("admin");
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit[0]).toMatchObject({ action: "user.promoted", actorId: null, targetId: ana });

    const err = await errorOf(t.mutation(internal.users.promoteToAdmin, { email: "nobody@example.test" }));
    expect(err.code).toBe("NOT_FOUND");
  });
});
