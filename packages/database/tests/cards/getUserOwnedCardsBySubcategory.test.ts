import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards } from "../../schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getUserOwnedCardsBySubcategory", () => {
  const fx = new TestFixtures();
  let userId: number;
  let subcategoryId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Owned By Subcat" })).id;
    const categoryId = (await fx.category({ name: `Test Subcat Group Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Subcat Group Subcategory" })).id;

    const cardIds: number[] = [];
    for (let i = 0; i < 12; i++) cardIds.push((await fx.card({ name: `Subcat Group Card ${i}`, subcategoryId })).id);

    await db.insert(userCards).values(cardIds.map(cardId => ({ userId, cardId, count: 1 })));
    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("caps the preview at 10 cards even though 12 are owned, but reports the real total", async () => {
    const result = await CardsDB.getUserOwnedCardsBySubcategory(userId, { query: "Subcat Group Card" });
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.subcategoryId).toBe(subcategoryId);
    expect(result.rows[0]!.total).toBe(12);
    expect(result.rows[0]!.cards).toHaveLength(10);
  });

  test("a query matching no cards in this subcategory excludes it entirely", async () => {
    const result = await CardsDB.getUserOwnedCardsBySubcategory(userId, { query: "zzzznonexistentzzzz" });
    expect(result.rows.find(r => r.subcategoryId === subcategoryId)).toBeUndefined();
  });
});
