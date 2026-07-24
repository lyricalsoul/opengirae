import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards, trades, cards, rarities } from "../../schemas/cards";
import { eq, inArray, and } from "drizzle-orm";
import { CardsDB, InsufficientCardError } from "../../cards";

// Correctness of the money-path swap: atomicity, commit-time re-validation, and the
// input-shape guards that stand between a caller bug and a corrupted trade. Real DB,
// real transactions, cleans up everything it creates.
describe("CardsDB.executeTrade", () => {
  const fx = new TestFixtures();
  let userAId: number, userBId: number;
  let cardXId: number, cardYId: number, cardZId: number;

  beforeAll(async () => {
    userAId = (await fx.user({ displayName: "Test A" })).id;
    userBId = (await fx.user({ displayName: "Test B" })).id;

    cardXId = (await fx.card({ name: "Test Card X" })).id;
    cardYId = (await fx.card({ name: "Test Card Y" })).id;
    cardZId = (await fx.card({ name: "Test Card Z" })).id;

    fx.onCleanup(async () => {
      await db.delete(trades).where(inArray(trades.user1Id, [userAId, userBId]));
      await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId]));
    });
  });

  afterAll(() => fx.cleanup());

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

  test("reports previous/new count crossings for the receiving side of each offer", async () => {
    await resetOwnership();
    await db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 1 });
    await db.insert(userCards).values({ userId: userBId, cardId: cardYId, count: 1 });
    await db.insert(userCards).values({ userId: userBId, cardId: cardXId, count: 3 }); // B already owns 3 X's

    const { crossings } = await CardsDB.executeTrade(
      userAId, [{ cardId: cardXId, count: 1 }],
      userBId, [{ cardId: cardYId, count: 1 }],
    );

    // B receives X: previousCount 3 -> newCount 4
    expect(crossings).toContainEqual({ userId: userBId, cardId: cardXId, previousCount: 3, newCount: 4 });
    // A receives Y for the first time: previousCount 0 -> newCount 1
    expect(crossings).toContainEqual({ userId: userAId, cardId: cardYId, previousCount: 0, newCount: 1 });
  });

  test("trading away cards that drop below the rarity's cativeiro threshold clears customization", async () => {
    const [{ rarityId, previousThreshold }] = await db
      .select({ rarityId: cards.rarityId, previousThreshold: rarities.cativeiroThreshold })
      .from(cards).innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(eq(cards.id, cardXId)).limit(1);
    await db.update(rarities).set({ cativeiroThreshold: 5 }).where(eq(rarities.id, rarityId));

    try {
      await resetOwnership();
      await db.insert(userCards).values({
        userId: userAId, cardId: cardXId, count: 5,
        customEmoji: '💎', customMediaUrl: 'https://example.com/x.jpg', customMediaType: 'photo',
      });
      await db.insert(userCards).values({ userId: userBId, cardId: cardYId, count: 1 });

      await CardsDB.executeTrade(
        userAId, [{ cardId: cardXId, count: 2 }],
        userBId, [{ cardId: cardYId, count: 1 }],
      );

      const [remaining] = await db.select().from(userCards)
        .where(and(eq(userCards.userId, userAId), eq(userCards.cardId, cardXId)));
      expect(remaining!.count).toBe(3);
      expect(remaining!.customEmoji).toBeNull();
      expect(remaining!.customMediaUrl).toBeNull();
      expect(remaining!.customMediaType).toBeNull();
    } finally {
      await db.update(rarities).set({ cativeiroThreshold: previousThreshold }).where(eq(rarities.id, rarityId));
    }
  });
});
