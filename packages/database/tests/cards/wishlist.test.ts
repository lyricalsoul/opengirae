import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { wishlist } from "../../schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB wishlist methods", () => {
  const fx = new TestFixtures();
  let userId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Wishlist" })).id;
    cardAId = (await fx.card({ name: "Test Wishlist Card A" })).id;
    cardBId = (await fx.card({ name: "Test Wishlist Card B" })).id;

    // safety net: each test below removes what it adds, but if one throws mid-test,
    // this still lets cards/user get deleted without an FK violation.
    fx.onCleanup(async () => { await db.delete(wishlist).where(eq(wishlist.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("isOnWishlist is false before anything is added", async () => {
    expect(await CardsDB.isOnWishlist(userId, cardAId)).toBe(false);
  });

  test("addToWishlist adds a card, isOnWishlist reflects it, adding twice is idempotent", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    expect(await CardsDB.isOnWishlist(userId, cardAId)).toBe(true);

    await CardsDB.addToWishlist(userId, cardAId);
    const { rows } = await CardsDB.getWishlist(userId, {});
    expect(rows.filter(r => r.id === cardAId)).toHaveLength(1);
  });

  test("removeFromWishlist removes it", async () => {
    await CardsDB.removeFromWishlist(userId, cardAId);
    expect(await CardsDB.isOnWishlist(userId, cardAId)).toBe(false);
  });

  test("getWishlist returns cards on the list with a query filter", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    await CardsDB.addToWishlist(userId, cardBId);

    const all = await CardsDB.getWishlist(userId, {});
    expect(all.total).toBe(2);
    expect(all.rows.map(r => r.id).sort()).toEqual([cardAId, cardBId].sort());

    const filtered = await CardsDB.getWishlist(userId, { query: "Card A" });
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0]!.id).toBe(cardAId);

    await CardsDB.removeFromWishlist(userId, cardAId);
    await CardsDB.removeFromWishlist(userId, cardBId);
  });

  test("getWishlist orders by position; addToWishlist appends to the end", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    await CardsDB.addToWishlist(userId, cardBId);

    const initial = await CardsDB.getWishlist(userId, {});
    expect(initial.rows.map(r => r.id)).toEqual([cardAId, cardBId]);

    await CardsDB.removeFromWishlist(userId, cardAId);
    await CardsDB.removeFromWishlist(userId, cardBId);
  });

  test("reorderWishlist persists a new order", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    await CardsDB.addToWishlist(userId, cardBId);

    await CardsDB.reorderWishlist(userId, [cardBId, cardAId]);
    const reordered = await CardsDB.getWishlist(userId, {});
    expect(reordered.rows.map(r => r.id)).toEqual([cardBId, cardAId]);

    await CardsDB.removeFromWishlist(userId, cardAId);
    await CardsDB.removeFromWishlist(userId, cardBId);
  });
});
