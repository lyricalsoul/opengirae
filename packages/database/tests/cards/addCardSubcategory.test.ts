import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, cardSubcategories, categories, subcategories, rarities } from "../../schemas/cards";
import { eq, and, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.addCardSubcategory", () => {
  let rarityId: number;
  let categoryId: number;
  let cardId: number;
  let mainSubcategoryId: number;
  let secondarySubcategoryId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);
    categoryId = await db.insert(categories).values({ name: `Test Category ${Date.now()}`, emoji: "🏷️" }).returning().then(r => r[0]!.id);
    mainSubcategoryId = await db.insert(subcategories).values({ name: `Main Sub ${Date.now()}`, categoryId }).returning().then(r => r[0]!.id);
    secondarySubcategoryId = await db.insert(subcategories).values({ name: `Secondary Sub ${Date.now()}`, categoryId }).returning().then(r => r[0]!.id);
    cardId = await db.insert(cards).values({ name: `Test Marksub Card ${Date.now()}`, rarityId }).returning().then(r => r[0]!.id);
    await db.insert(cardSubcategories).values({ cardId, subcategoryId: mainSubcategoryId, isMain: true });
  });

  afterAll(async () => {
    await db.delete(cardSubcategories).where(eq(cardSubcategories.cardId, cardId));
    await db.delete(cards).where(eq(cards.id, cardId));
    await db.delete(subcategories).where(inArray(subcategories.id, [mainSubcategoryId, secondarySubcategoryId]));
    await db.delete(categories).where(eq(categories.id, categoryId));
  });

  test("adds a secondary subcategory without touching the main one", async () => {
    await CardsDB.addCardSubcategory(cardId, secondarySubcategoryId);

    const rows = await db.select().from(cardSubcategories).where(eq(cardSubcategories.cardId, cardId));
    expect(rows.length).toBe(2);

    const main = rows.find(r => r.subcategoryId === mainSubcategoryId);
    expect(main?.isMain).toBe(true);

    const secondary = rows.find(r => r.subcategoryId === secondarySubcategoryId);
    expect(secondary?.isMain).toBe(false);
  });

  test("is idempotent when the card is already tagged with the subcategory", async () => {
    await CardsDB.addCardSubcategory(cardId, secondarySubcategoryId);
    await CardsDB.addCardSubcategory(cardId, secondarySubcategoryId);

    const rows = await db.select().from(cardSubcategories)
      .where(and(eq(cardSubcategories.cardId, cardId), eq(cardSubcategories.subcategoryId, secondarySubcategoryId)));
    expect(rows.length).toBe(1);
  });
});
