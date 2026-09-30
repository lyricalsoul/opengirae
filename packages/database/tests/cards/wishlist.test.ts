import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { wishlist, userCards } from "../../schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB wishlist methods", () => {
  const fx = new TestFixtures();
  let userId: number;
  let viewerId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Wishlist" })).id;
    viewerId = (await fx.user({ displayName: "Test Wishlist Viewer" })).id;
    cardAId = (await fx.card({ name: "Test Wishlist Card A" })).id;
    cardBId = (await fx.card({ name: "Test Wishlist Card B" })).id;

    // safety net: each test below removes what it adds, but if one throws mid-test,
    // this still lets cards/user get deleted without an FK violation.
    fx.onCleanup(async () => {
      await db.delete(wishlist).where(eq(wishlist.userId, userId));
      await db.delete(userCards).where(eq(userCards.userId, viewerId));
    });
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

  test("removeManyFromWishlist removes only the requested cards and reports which were actually on the list", async () => {
    await CardsDB.addToWishlist(userId, cardAId);

    const removed = await CardsDB.removeManyFromWishlist(userId, [cardAId, cardBId]);
    expect(removed).toEqual([cardAId]);
    expect(await CardsDB.isOnWishlist(userId, cardAId)).toBe(false);
  });

  test("getWishlist's viewerId reports how many of each card the viewer (not the list owner) owns", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    await CardsDB.addToWishlist(userId, cardBId);
    await CardsDB.addUserCard(viewerId, cardAId, 1); // viewer owns A, not B

    const { rows } = await CardsDB.getWishlist(userId, { viewerId });
    const byId = new Map(rows.map(r => [r.id, r.viewerOwnedCount]));
    expect(byId.get(cardAId)).toBe(1);
    expect(byId.get(cardBId)).toBe(0);

    // omitting viewerId reports 0 for everything rather than leaking the list owner's own count
    const { rows: withoutViewer } = await CardsDB.getWishlist(userId, {});
    expect(withoutViewer.every(r => r.viewerOwnedCount === 0)).toBe(true);

    await CardsDB.removeFromWishlist(userId, cardAId);
    await CardsDB.removeFromWishlist(userId, cardBId);
  });

  test("clearWishlist removes everything for that user", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    await CardsDB.addToWishlist(userId, cardBId);

    await CardsDB.clearWishlist(userId);
    const { total } = await CardsDB.getWishlist(userId, {});
    expect(total).toBe(0);
  });
});
