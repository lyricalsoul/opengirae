import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, userCards, rarities, categories, subcategories, cardSubcategories } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getCardsInSubcategoryForUserPaginated", () => {
  let userId: number;
  let rarityId: number;
  let categoryId: number;
  let subcategoryId: number;
  let ownedCardIds: number[];
  let missingCardIds: number[];

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({
      telegramId: `test-subcat-paginated-${Date.now()}`, displayName: "Test Subcat Paginated", avatarUrl: "",
    }).returning();
    userId = user!.id;

    const [category] = await db.insert(categories).values({
      name: `Test Subcat Paginated Category ${Date.now()}`, emoji: "🧪",
    }).returning();
    categoryId = category!.id;

    const [subcategory] = await db.insert(subcategories).values({
      categoryId, name: "Test Subcat Paginated Subcategory",
    }).returning();
    subcategoryId = subcategory!.id;

    const owned = await db.insert(cards).values(
      Array.from({ length: 15 }, (_, i) => ({ name: `Subcat Paginated Owned ${i}`, rarityId })),
    ).returning();
    ownedCardIds = owned.map(c => c.id);

    const missing = await db.insert(cards).values(
      Array.from({ length: 3 }, (_, i) => ({ name: `Subcat Paginated Missing ${i}`, rarityId })),
    ).returning();
    missingCardIds = missing.map(c => c.id);

    const allCardIds = [...ownedCardIds, ...missingCardIds];
    await db.insert(cardSubcategories).values(allCardIds.map(cardId => ({ cardId, subcategoryId, isMain: true })));
    await db.insert(userCards).values(ownedCardIds.map(cardId => ({ userId, cardId, count: 1 })));
  });

  afterAll(async () => {
    const allCardIds = [...ownedCardIds, ...missingCardIds];
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cardSubcategories).where(inArray(cardSubcategories.cardId, allCardIds));
    await db.delete(cards).where(inArray(cards.id, allCardIds));
    await db.delete(subcategories).where(eq(subcategories.id, subcategoryId));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(users).where(eq(users.id, userId));
  });

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
