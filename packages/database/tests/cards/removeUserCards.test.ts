import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards } from "../../schemas/cards";
import { eq, and } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.removeUserCards", () => {
  const fx = new TestFixtures();
  let userId: number;
  let rarityId: number;
  let cardId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Remove User Cards" })).id;
    rarityId = (await fx.rarity({ name: `Test Remove Cards Rarity ${Date.now()}`, cativeiroThreshold: 10 })).id;
    const categoryId = (await fx.category({ name: `Test Remove Cards Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: "Test Remove Cards Subcategory" })).id;
    cardId = (await fx.card({ name: "Test Remove Cards Card", rarityId, subcategoryId })).id;
  });

  afterAll(() => fx.cleanup());

  test("fails when the user doesn't own the card at all", async () => {
    const result = await CardsDB.removeUserCards(userId, cardId, 1);
    expect(result.ok).toBe(false);
  });

  test("decrements a partial removal and clears customization once below the cativeiro threshold", async () => {
    await fx.ownCard(userId, cardId, 20);
    await db.update(userCards)
      .set({ customEmoji: '🎀' })
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));

    const result = await CardsDB.removeUserCards(userId, cardId, 15); // 20 -> 5, below the threshold of 10
    expect(result).toEqual({ ok: true, remainingCount: 5 });

    const [row] = await db.select().from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    expect(row?.count).toBe(5);
    expect(row?.customEmoji).toBeNull();
  });

  test("removing every remaining copy deletes the row instead of leaving count 0", async () => {
    const result = await CardsDB.removeUserCards(userId, cardId, 5);
    expect(result).toEqual({ ok: true, remainingCount: 0 });

    const [row] = await db.select().from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    expect(row).toBeUndefined();
  });

  test("fails atomically when asking for more than currently owned", async () => {
    await fx.ownCard(userId, cardId, 3);

    const result = await CardsDB.removeUserCards(userId, cardId, 10);
    expect(result.ok).toBe(false);

    const [row] = await db.select().from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    expect(row?.count).toBe(3);
  });
});
