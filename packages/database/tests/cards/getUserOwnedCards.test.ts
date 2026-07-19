import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, userCards, rarities } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getUserOwnedCards", () => {
  let userId: number;
  let rarityId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({
      displayName: "Test Owned", avatarUrl: "",
    }).returning();
    userId = user!.id;

    const [a, b] = await db.insert(cards).values([
      { name: "Owned Cards Zebra", rarityId },
      { name: "Owned Cards Apple", rarityId },
    ]).returning();
    cardAId = a!.id;
    cardBId = b!.id;

    await db.insert(userCards).values([
      { userId, cardId: cardAId, count: 1 },
      { userId, cardId: cardBId, count: 2 },
    ]);
  });

  afterAll(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cards).where(inArray(cards.id, [cardAId, cardBId]));
    await db.delete(users).where(eq(users.id, userId));
  });

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
