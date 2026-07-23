import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, userCards, rarities } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getDuplicateCards", () => {
  let userId: number;
  let rarityId: number;
  let singleCardId: number, duplicateCardId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({
      displayName: "Test Duplicates", avatarUrl: "",
    }).returning();
    userId = user!.id;

    const [a, b] = await db.insert(cards).values([
      { name: "Duplicate Cards Single", rarityId },
      { name: "Duplicate Cards Duped", rarityId },
    ]).returning();
    singleCardId = a!.id;
    duplicateCardId = b!.id;

    await db.insert(userCards).values([
      { userId, cardId: singleCardId, count: 1 },
      { userId, cardId: duplicateCardId, count: 2 },
    ]);
  });

  afterAll(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cards).where(inArray(cards.id, [singleCardId, duplicateCardId]));
    await db.delete(users).where(eq(users.id, userId));
  });

  test("excludes cards owned only once and includes cards owned more than once", async () => {
    const result = await CardsDB.getDuplicateCards(userId);
    expect(result.rows.some(c => c.id === singleCardId)).toBe(false);
    expect(result.rows.some(c => c.id === duplicateCardId)).toBe(true);
    expect(result.total).toBe(1);
  });
});
