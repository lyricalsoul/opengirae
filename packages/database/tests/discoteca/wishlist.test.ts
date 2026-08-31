import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { discotecaWishlist } from "../../schemas/discoteca";
import { eq } from "drizzle-orm";
import { DiscotecaDB } from "../../discoteca";

describe("DiscotecaDB wishlist methods", () => {
  const fx = new TestFixtures();
  let userId: number;
  let entryAId: number, entryBId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Discoteca Wishlist" })).id;
    entryAId = (await fx.discotecaEntry({ name: "Test Wishlist Entry A" })).id;
    entryBId = (await fx.discotecaEntry({ name: "Test Wishlist Entry B" })).id;

    // safety net in case a test throws mid-run and skips its own cleanup
    fx.onCleanup(async () => { await db.delete(discotecaWishlist).where(eq(discotecaWishlist.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("isOnWishlist is false before anything is added", async () => {
    expect(await DiscotecaDB.isOnWishlist(userId, entryAId)).toBe(false);
  });

  test("addToWishlist adds an entry, isOnWishlist reflects it, adding twice is idempotent", async () => {
    await DiscotecaDB.addToWishlist(userId, entryAId);
    expect(await DiscotecaDB.isOnWishlist(userId, entryAId)).toBe(true);

    await DiscotecaDB.addToWishlist(userId, entryAId);
    const { rows } = await DiscotecaDB.getWishlist(userId, {});
    expect(rows.filter(r => r.id === entryAId)).toHaveLength(1);

    await DiscotecaDB.removeFromWishlist(userId, entryAId);
  });

  test("removeFromWishlist removes it", async () => {
    await DiscotecaDB.addToWishlist(userId, entryAId);
    await DiscotecaDB.removeFromWishlist(userId, entryAId);
    expect(await DiscotecaDB.isOnWishlist(userId, entryAId)).toBe(false);
  });

  test("getWishlist returns entries on the list, ordered by insertion (position)", async () => {
    await DiscotecaDB.addToWishlist(userId, entryAId);
    await DiscotecaDB.addToWishlist(userId, entryBId);

    const { rows, total } = await DiscotecaDB.getWishlist(userId, {});
    expect(total).toBe(2);
    expect(rows.map(r => r.id)).toEqual([entryAId, entryBId]);

    await DiscotecaDB.removeFromWishlist(userId, entryAId);
    await DiscotecaDB.removeFromWishlist(userId, entryBId);
  });
});
