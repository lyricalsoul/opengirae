import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards } from "../../schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getDuplicateCards", () => {
  const fx = new TestFixtures();
  let userId: number;
  let singleCardId: number, duplicateCardId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Duplicates" })).id;
    singleCardId = (await fx.card({ name: "Duplicate Cards Single" })).id;
    duplicateCardId = (await fx.card({ name: "Duplicate Cards Duped" })).id;

    await db.insert(userCards).values([
      { userId, cardId: singleCardId, count: 1 },
      { userId, cardId: duplicateCardId, count: 2 },
    ]);
    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("excludes cards owned only once and includes cards owned more than once", async () => {
    const result = await CardsDB.getDuplicateCards(userId);
    expect(result.rows.some(c => c.id === singleCardId)).toBe(false);
    expect(result.rows.some(c => c.id === duplicateCardId)).toBe(true);
    expect(result.total).toBe(1);
  });
});
