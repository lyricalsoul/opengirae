import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, userCards, trades, rarities } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB, InsufficientCardError } from "../../cards";

// Correctness of the money-path swap: atomicity, commit-time re-validation, and the
// input-shape guards that stand between a caller bug and a corrupted trade. Real DB,
// real transactions, cleans up everything it creates.
describe("CardsDB.executeTrade", () => {
  let rarityId: number;
  let userAId: number, userBId: number;
  let cardXId: number, cardYId: number, cardZId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [a, b] = await db.insert(users).values([
      { telegramId: `test-trade-a-${Date.now()}`, displayName: "Test A", avatarUrl: "" },
      { telegramId: `test-trade-b-${Date.now()}`, displayName: "Test B", avatarUrl: "" },
    ]).returning();
    userAId = a!.id;
    userBId = b!.id;

    const [x, y, z] = await db.insert(cards).values([
      { name: "Test Card X", rarityId },
      { name: "Test Card Y", rarityId },
      { name: "Test Card Z", rarityId },
    ]).returning();
    cardXId = x!.id;
    cardYId = y!.id;
    cardZId = z!.id;
  });

  afterAll(async () => {
    await db.delete(trades).where(inArray(trades.user1Id, [userAId, userBId]));
    await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId]));
    await db.delete(cards).where(inArray(cards.id, [cardXId, cardYId, cardZId]));
    await db.delete(users).where(inArray(users.id, [userAId, userBId]));
  });

  async function resetOwnership() {
    await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId]));
  }

  async function ownedCount(userId: number, cardId: number): Promise<number> {
    return db.select().from(userCards)
      .where(eq(userCards.userId, userId))
      .then(rows => rows.find(r => r.cardId === cardId)?.count ?? 0);
  }

  test("swaps cards atomically and records history", async () => {
    await resetOwnership();
    await db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 1 });
    await db.insert(userCards).values({ userId: userBId, cardId: cardYId, count: 1 });

    await CardsDB.executeTrade(
      userAId, [{ cardId: cardXId, count: 1 }],
      userBId, [{ cardId: cardYId, count: 1 }],
    );

    expect(await ownedCount(userAId, cardYId)).toBe(1);
    expect(await ownedCount(userBId, cardXId)).toBe(1);
    expect(await ownedCount(userAId, cardXId)).toBe(0); // fully-decremented row is deleted, not left at 0

    const historyRow = await db.select().from(trades).where(eq(trades.user1Id, userAId)).then(r => r[0]);
    expect(historyRow?.cardsUser1).toEqual([cardXId]);
    expect(historyRow?.cardsUser2).toEqual([cardYId]);
  });

  test("rolls back the whole trade if a card vanished since it was offered", async () => {
    await resetOwnership();
    await db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 1 });
    // userB does NOT have cardY this time

    await expect(
      CardsDB.executeTrade(
        userAId, [{ cardId: cardXId, count: 1 }],
        userBId, [{ cardId: cardYId, count: 1 }],
      )
    ).rejects.toBeInstanceOf(InsufficientCardError);

    // userA's card must still be there - offerA's successful decrement must have been
    // rolled back along with offerB's failure, not partially applied
    expect(await ownedCount(userAId, cardXId)).toBe(1);
  });

  test("swaps a partial count, leaving the remainder owned", async () => {
    await resetOwnership();
    await db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 5 });
    await db.insert(userCards).values({ userId: userBId, cardId: cardYId, count: 1 });

    await CardsDB.executeTrade(
      userAId, [{ cardId: cardXId, count: 2 }],
      userBId, [{ cardId: cardYId, count: 1 }],
    );

    expect(await ownedCount(userAId, cardXId)).toBe(3); // 5 - 2, row survives (not deleted)
    expect(await ownedCount(userBId, cardXId)).toBe(2);
  });

  test("swaps multiple distinct cards on both sides in one trade", async () => {
    await resetOwnership();
    await db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 1 });
    await db.insert(userCards).values({ userId: userAId, cardId: cardYId, count: 1 });
    await db.insert(userCards).values({ userId: userBId, cardId: cardZId, count: 1 });

    await CardsDB.executeTrade(
      userAId, [{ cardId: cardXId, count: 1 }, { cardId: cardYId, count: 1 }],
      userBId, [{ cardId: cardZId, count: 1 }],
    );

    expect(await ownedCount(userBId, cardXId)).toBe(1);
    expect(await ownedCount(userBId, cardYId)).toBe(1);
    expect(await ownedCount(userAId, cardZId)).toBe(1);
  });

  test("rejects the same user on both sides", async () => {
    await expect(
      CardsDB.executeTrade(userAId, [{ cardId: cardXId, count: 1 }], userAId, [{ cardId: cardYId, count: 1 }])
    ).rejects.toThrow('userAId and userBId must differ');
  });

  test("rejects an offer that lists the same cardId twice", async () => {
    await resetOwnership();
    await db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 3 });

    await expect(
      CardsDB.executeTrade(
        userAId, [{ cardId: cardXId, count: 1 }, { cardId: cardXId, count: 2 }],
        userBId, [{ cardId: cardYId, count: 1 }],
      )
    ).rejects.toThrow('same cardId twice');
  });

  test("rejects a non-positive count", async () => {
    await expect(
      CardsDB.executeTrade(userAId, [{ cardId: cardXId, count: 0 }], userBId, [{ cardId: cardYId, count: 1 }])
    ).rejects.toThrow('must be positive');
  });
});
