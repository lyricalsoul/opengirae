import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { cardSubcategories, cardDrawHistory, chocolateFactoryCorrections, subcategories } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

// deleteSubcategory must only be gated on current card count (cardSubcategories rows)
// - draw history and chocolate-factory name corrections referencing the subcategory
// used to also block deletion; they now cascade-delete at the schema level (ON DELETE
// CASCADE) instead, so a subcategory that's 0 cards but has history/corrections is
// still deletable, and the FK cascade must actually clean those rows up rather than
// erroring out.
describe("CardsDB.deleteSubcategory", () => {
  const fx = new TestFixtures();
  let categoryId: number;
  let userId: number;
  let cardId: number;

  beforeAll(async () => {
    categoryId = (await fx.category({ name: `Test Category ${Date.now()}` })).id;
    userId = (await fx.user({ displayName: "Test" })).id;
    cardId = (await fx.card({ name: "Test Delsub Card" })).id;
  });

  afterAll(() => fx.cleanup());

  async function makeSubcategory(name: string): Promise<number> {
    return (await CardsDB.createSubcategory(name, categoryId))!.id;
  }

  test("refuses to delete a subcategory that still has cards", async () => {
    const subcategoryId = await makeSubcategory(`Has Cards ${Date.now()}`);
    await db.insert(cardSubcategories).values({ cardId, subcategoryId, isMain: true });

    const result = await CardsDB.deleteSubcategory(subcategoryId);
    expect(result).toEqual({ ok: false, reason: 'has_cards' });

    const stillThere = await db.select().from(subcategories).where(eq(subcategories.id, subcategoryId));
    expect(stillThere.length).toBe(1);

    await db.delete(cardSubcategories).where(inArray(cardSubcategories.subcategoryId, [subcategoryId]));
    await db.delete(subcategories).where(eq(subcategories.id, subcategoryId));
  });

  test("deletes a card-free subcategory and cascades its draw history and corrections", async () => {
    const subcategoryId = await makeSubcategory(`Deletable ${Date.now()}`);
    await db.insert(cardDrawHistory).values({ userId, cardId, categoryId, subcategoryId });
    await db.insert(chocolateFactoryCorrections).values({ targetName: `correction-${Date.now()}`, subcategoryId });

    const result = await CardsDB.deleteSubcategory(subcategoryId);
    expect(result).toEqual({ ok: true });

    const gone = await db.select().from(subcategories).where(eq(subcategories.id, subcategoryId));
    expect(gone.length).toBe(0);

    // the FK cascade must have taken the referencing rows down with it, not left them
    // orphaned or thrown a constraint violation that would've surfaced as a thrown error above
    const historyGone = await db.select().from(cardDrawHistory).where(eq(cardDrawHistory.subcategoryId, subcategoryId));
    expect(historyGone.length).toBe(0);
    const correctionGone = await db.select().from(chocolateFactoryCorrections).where(eq(chocolateFactoryCorrections.subcategoryId, subcategoryId));
    expect(correctionGone.length).toBe(0);
  });
});
