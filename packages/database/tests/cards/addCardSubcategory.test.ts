import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { cardSubcategories } from "../../schemas/cards";
import { eq, and } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.addCardSubcategory", () => {
  const fx = new TestFixtures();
  let cardId: number;
  let mainSubcategoryId: number;
  let secondarySubcategoryId: number;

  beforeAll(async () => {
    const categoryId = (await fx.category({ name: `Test Category ${Date.now()}` })).id;
    mainSubcategoryId = (await fx.subcategory({ categoryId, name: `Main Sub ${Date.now()}` })).id;
    secondarySubcategoryId = (await fx.subcategory({ categoryId, name: `Secondary Sub ${Date.now()}` })).id;
    cardId = (await fx.card({ name: `Test Marksub Card ${Date.now()}`, subcategoryId: mainSubcategoryId })).id;
  });

  afterAll(() => fx.cleanup());

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
