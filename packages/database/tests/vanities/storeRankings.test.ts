import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { storeItems, boughtItems } from "../../schemas/vanities";
import { eq, inArray } from "drizzle-orm";
import { VanitiesDB } from "../../vanities";

describe("VanitiesDB store ranking queries", () => {
  let popularItemId: number, unpopularItemId: number;
  let buyerId: number;

  beforeAll(async () => {
    const [popular, unpopular] = await db.insert(storeItems).values([
      { title: `Ranking Popular ${Date.now()}`, description: "d", type: "sticker", price: 10, itemURL: "https://example.com/a.png" },
      { title: `Ranking Unpopular ${Date.now()}`, description: "d", type: "sticker", price: 10, itemURL: "https://example.com/b.png" },
    ]).returning();
    popularItemId = popular!.id;
    unpopularItemId = unpopular!.id;

    const [buyer] = await db.insert(users).values({
      telegramId: `test-ranking-buyer-${Date.now()}`, displayName: "Buyer", avatarUrl: "",
    }).returning();
    buyerId = buyer!.id;

    await db.insert(boughtItems).values({ userId: buyerId, itemId: popularItemId });
  });

  afterAll(async () => {
    await db.delete(boughtItems).where(eq(boughtItems.userId, buyerId));
    await db.delete(storeItems).where(inArray(storeItems.id, [popularItemId, unpopularItemId]));
    await db.delete(users).where(eq(users.id, buyerId));
  });

  test("listStoreItemsByPopularity orders the purchased item first", async () => {
    const result = await VanitiesDB.listStoreItemsByPopularity('sticker', { limit: 50 });
    const ids = result.rows.map(r => r.id);
    expect(ids.indexOf(popularItemId)).toBeLessThan(ids.indexOf(unpopularItemId));
    expect(result.rows.find(r => r.id === popularItemId)!.purchaseCount).toBe(1);
  });

  test("listStoreItemsByRecency orders the more recently created item first", async () => {
    const result = await VanitiesDB.listStoreItemsByRecency('sticker', { limit: 50 });
    const ids = result.rows.map(r => r.id);
    // unpopular was inserted after popular in the same beforeAll batch
    expect(ids.indexOf(unpopularItemId)).toBeLessThan(ids.indexOf(popularItemId));
  });
});
