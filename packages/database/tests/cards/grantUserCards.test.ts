import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards } from "../../schemas/cards";
import { eq, and } from "drizzle-orm";
import { CardsDB } from "../../cards";
import { EconomyDB } from "../../economy";

describe("CardsDB.grantUserCards", () => {
  const fx = new TestFixtures();
  let userId: number;
  let cardId: number;
  let incomeInflationRate: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Grant User Cards" })).id;
    const categoryId = (await fx.category({ name: `Test Grant Cards Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: "Test Grant Cards Subcategory" })).id;
    cardId = (await fx.card({ name: "Test Grant Cards Card", subcategoryId })).id;
    incomeInflationRate = await EconomyDB.getIncomeInflationRate();

    // runs first (LIFO), before the userCards row this test creates would block their deletes.
    fx.onCleanup(async () => {
      await db.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    });
  });

  afterAll(() => fx.cleanup());

  test("grants N fresh copies in one write when the user owns none yet", async () => {
    const result = await CardsDB.grantUserCards(userId, cardId, 50, incomeInflationRate);
    expect(result.previousCount).toBe(0);
    expect(result.newCount).toBe(50);

    const [row] = await db.select().from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    expect(row?.count).toBe(50);
  });

  test("stacks onto an existing count", async () => {
    const result = await CardsDB.grantUserCards(userId, cardId, 5, incomeInflationRate);
    expect(result.previousCount).toBe(50);
    expect(result.newCount).toBe(55);

    const [row] = await db.select().from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    expect(row?.count).toBe(55);
  });
});
