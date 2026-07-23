import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards } from "../../schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getCardsInSubcategoryForUserPaginated", () => {
  const fx = new TestFixtures();
  let userId: number;
  let subcategoryId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Subcat Paginated" })).id;
    const categoryId = (await fx.category({ name: `Test Subcat Paginated Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Subcat Paginated Subcategory" })).id;

    const ownedCardIds: number[] = [];
    for (let i = 0; i < 15; i++) ownedCardIds.push((await fx.card({ name: `Subcat Paginated Owned ${i}`, subcategoryId })).id);
    for (let i = 0; i < 3; i++) await fx.card({ name: `Subcat Paginated Missing ${i}`, subcategoryId });

    await db.insert(userCards).values(ownedCardIds.map(cardId => ({ userId, cardId, count: 1 })));
    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("paginates the owned filter and reports both counts regardless of the active filter", async () => {
    const page1 = await CardsDB.getCardsInSubcategoryForUserPaginated(subcategoryId, userId, { ownedFilter: 'owned', limit: 10, offset: 0 });
    expect(page1.rows).toHaveLength(10);
    expect(page1.total).toBe(15);
    expect(page1.ownedCount).toBe(15);
    expect(page1.missingCount).toBe(3);

    const page2 = await CardsDB.getCardsInSubcategoryForUserPaginated(subcategoryId, userId, { ownedFilter: 'owned', limit: 10, offset: 10 });
    expect(page2.rows).toHaveLength(5);
  });

  test("the missing filter returns only unowned cards", async () => {
    const result = await CardsDB.getCardsInSubcategoryForUserPaginated(subcategoryId, userId, { ownedFilter: 'missing', limit: 10 });
    expect(result.rows).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.rows.every(r => r.ownedCount === 0)).toBe(true);
  });
});
