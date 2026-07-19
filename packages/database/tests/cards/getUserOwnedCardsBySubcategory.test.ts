import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, userCards, rarities, categories, subcategories, cardSubcategories } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getUserOwnedCardsBySubcategory", () => {
  let userId: number;
  let rarityId: number;
  let categoryId: number;
  let subcategoryId: number;
  let cardIds: number[];

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({
      displayName: "Test Owned By Subcat", avatarUrl: "",
    }).returning();
    userId = user!.id;

    const [category] = await db.insert(categories).values({
      name: `Test Subcat Group Category ${Date.now()}`, emoji: "🧪",
    }).returning();
    categoryId = category!.id;

    const [subcategory] = await db.insert(subcategories).values({
      categoryId, name: "Test Subcat Group Subcategory",
    }).returning();
    subcategoryId = subcategory!.id;

    const inserted = await db.insert(cards).values(
      Array.from({ length: 12 }, (_, i) => ({ name: `Subcat Group Card ${i}`, rarityId })),
    ).returning();
    cardIds = inserted.map(c => c.id);

    await db.insert(cardSubcategories).values(cardIds.map(cardId => ({ cardId, subcategoryId, isMain: true })));
    await db.insert(userCards).values(cardIds.map(cardId => ({ userId, cardId, count: 1 })));
  });

  afterAll(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cardSubcategories).where(inArray(cardSubcategories.cardId, cardIds));
    await db.delete(cards).where(inArray(cards.id, cardIds));
    await db.delete(subcategories).where(eq(subcategories.id, subcategoryId));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(users).where(eq(users.id, userId));
  });

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
