import { test, expect, describe, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { UsersDB } from "../../users";

describe("UsersDB.getUsersByIds", () => {
  const fx = new TestFixtures();

  afterAll(() => fx.cleanup());

  test("batch-resolves users for the given ids, skipping unknown ones", async () => {
    const a = await fx.user({ displayName: "Batch Users A" });
    const b = await fx.user({ displayName: "Batch Users B" });

    const rows = await UsersDB.getUsersByIds([a.id, b.id, 999999999]);
    const byId = new Map(rows.map(u => [u.id, u]));

    expect(byId.get(a.id)?.displayName).toBe("Batch Users A");
    expect(byId.get(b.id)?.displayName).toBe("Batch Users B");
    expect(byId.has(999999999)).toBe(false);
  });

  test("returns an empty array for an empty id list", async () => {
    const rows = await UsersDB.getUsersByIds([]);
    expect(rows).toEqual([]);
  });
});
