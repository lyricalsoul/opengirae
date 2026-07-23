import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { boughtItems } from "../../schemas/vanities";
import { VanitiesDB } from "../../vanities";

describe("VanitiesDB store ranking queries", () => {
  const fx = new TestFixtures();
  let popularItemId: number, unpopularItemId: number;

  beforeAll(async () => {
    // registration order matters for cleanup: the buyer must be registered (and thus
    // torn down) *after* the store items, since boughtItems.itemId cascade-deletes on
    // the item but boughtItems.userId does not cascade on the user - deleting the user
    // first would FK-violate on a still-existing boughtItems row.
    const buyerId = (await fx.user({ displayName: "Buyer" })).id;
    popularItemId = (await fx.storeItem({ title: `Ranking Popular ${Date.now()}`, type: 'sticker', price: 10, itemURL: "https://example.com/a.png" })).id;
    unpopularItemId = (await fx.storeItem({ title: `Ranking Unpopular ${Date.now()}`, type: 'sticker', price: 10, itemURL: "https://example.com/b.png" })).id;

    await db.insert(boughtItems).values({ userId: buyerId, itemId: popularItemId });
  });

  afterAll(() => fx.cleanup());

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
