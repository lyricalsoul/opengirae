import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards } from "../../schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getUserOwnedCards", () => {
  const fx = new TestFixtures();
  let userId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Owned" })).id;
    cardAId = (await fx.card({ name: "Owned Cards Zebra" })).id;
    cardBId = (await fx.card({ name: "Owned Cards Apple" })).id;

    await db.insert(userCards).values([
      { userId, cardId: cardAId, count: 1 },
      { userId, cardId: cardBId, count: 2 },
    ]);
    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("getUserOwnedCards (bare array) is unchanged - backward compatible with /cts", async () => {
    const result = await CardsDB.getUserOwnedCards(userId);
    expect(Array.isArray(result)).toBe(true);
    expect(result.some(c => c.id === cardAId)).toBe(true);
    expect(result.some(c => c.id === cardBId)).toBe(true);
  });

  test("getUserOwnedCardsPaginated respects limit/offset", async () => {
    const page1 = await CardsDB.getUserOwnedCardsPaginated(userId, { limit: 1, offset: 0 });
    expect(page1.total).toBe(2);
    expect(page1.rows).toHaveLength(1);

    const page2 = await CardsDB.getUserOwnedCardsPaginated(userId, { limit: 1, offset: 1 });
    expect(page2.rows).toHaveLength(1);
    expect(page2.rows[0]!.id).not.toBe(page1.rows[0]!.id);
  });

  test("getUserOwnedCardsPaginated filters by card name via query", async () => {
    const result = await CardsDB.getUserOwnedCardsPaginated(userId, { query: "Zebra" });
    expect(result.total).toBe(1);
    expect(result.rows[0]!.id).toBe(cardAId);
  });
});
