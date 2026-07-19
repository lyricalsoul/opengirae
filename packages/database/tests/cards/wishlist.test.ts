import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, rarities, wishlist } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB wishlist methods", () => {
  let userId: number;
  let rarityId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({
      displayName: "Test Wishlist", avatarUrl: "",
    }).returning();
    userId = user!.id;

    const [a, b] = await db.insert(cards).values([
      { name: "Test Wishlist Card A", rarityId },
      { name: "Test Wishlist Card B", rarityId },
    ]).returning();
    cardAId = a!.id;
    cardBId = b!.id;
  });

  afterAll(async () => {
    await db.delete(wishlist).where(eq(wishlist.userId, userId));
    await db.delete(cards).where(inArray(cards.id, [cardAId, cardBId]));
    await db.delete(users).where(eq(users.id, userId));
  });

  test("isOnWishlist is false before anything is added", async () => {
    expect(await CardsDB.isOnWishlist(userId, cardAId)).toBe(false);
  });

  test("addToWishlist adds a card, isOnWishlist reflects it, adding twice is idempotent", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    expect(await CardsDB.isOnWishlist(userId, cardAId)).toBe(true);

    await CardsDB.addToWishlist(userId, cardAId);
    const rows = await db.select().from(wishlist).where(eq(wishlist.userId, userId));
    expect(rows.filter(r => r.cardId === cardAId)).toHaveLength(1);
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
