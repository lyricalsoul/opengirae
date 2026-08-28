import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards, trades } from "../../schemas/cards";
import { userDiscoteca } from "../../schemas/discoteca";
import { eq, inArray, and } from "drizzle-orm";
import { CardsDB } from "../../cards";
import { InsufficientCardError } from "../../cards";
import { InsufficientDiscotecaEntryError } from "../../discoteca";

// mirrors tests/trade/executeTrade.test.ts's shape, for the mixed cards+Discoteca path.
describe("CardsDB.executeMixedTrade", () => {
  const fx = new TestFixtures();
  let userAId: number, userBId: number;
  let cardXId: number, cardYId: number;
  let entryXId: number, entryYId: number;

  beforeAll(async () => {
    userAId = (await fx.user({ displayName: "Test Mixed A" })).id;
    userBId = (await fx.user({ displayName: "Test Mixed B" })).id;

    cardXId = (await fx.card({ name: "Test Mixed Card X" })).id;
    cardYId = (await fx.card({ name: "Test Mixed Card Y" })).id;
    entryXId = (await fx.discotecaEntry({ name: "Test Mixed Entry X" })).id;
    entryYId = (await fx.discotecaEntry({ name: "Test Mixed Entry Y" })).id;

    fx.onCleanup(async () => {
      await db.delete(trades).where(inArray(trades.user1Id, [userAId, userBId]));
      await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId]));
      await db.delete(userDiscoteca).where(inArray(userDiscoteca.userId, [userAId, userBId]));
    });
  });

  afterAll(() => fx.cleanup());

  async function reset() {
    await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId]));
    await db.delete(userDiscoteca).where(inArray(userDiscoteca.userId, [userAId, userBId]));
  }

  async function ownedCardCount(userId: number, cardId: number): Promise<number> {
    return db.select().from(userCards)
      .where(eq(userCards.userId, userId))
      .then(rows => rows.find(r => r.cardId === cardId)?.count ?? 0);
  }

  async function ownedEntryCount(userId: number, entryId: number): Promise<number> {
    return db.select().from(userDiscoteca)
      .where(eq(userDiscoteca.userId, userId))
      .then(rows => rows.find(r => r.entryId === entryId)?.count ?? 0);
  }

  // plain try/catch, not expect(promise).rejects - that matcher hangs bun test v1.3.14 (03-commands.md).
  async function captureRejection(p: Promise<unknown>): Promise<unknown> {
    try {
      await p;
      return undefined;
    } catch (e) {
      return e;
    }
  }

  test("swaps a card for a tradable discoteca entry atomically and records both in history", async () => {
    await reset();
    await db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 1 });
    await db.insert(userDiscoteca).values({ userId: userBId, entryId: entryYId, count: 1, tradable: true });

    await CardsDB.executeMixedTrade(
      userAId, [{ cardId: cardXId, count: 1 }], [],
      userBId, [], [{ entryId: entryYId, count: 1 }],
      1,
    );

    expect(await ownedEntryCount(userAId, entryYId)).toBe(1);
    expect(await ownedCardCount(userBId, cardXId)).toBe(1);
    expect(await ownedCardCount(userAId, cardXId)).toBe(0);

    const historyRow = await db.select().from(trades).where(eq(trades.user1Id, userAId)).then(r => r[0]);
    expect(historyRow?.cardsUser1).toEqual([cardXId]);
    expect(historyRow?.discotecaUser2).toEqual([entryYId]);
    expect(historyRow?.discotecaUser1).toEqual([]);
    expect(historyRow?.cardsUser2).toEqual([]);
  });

  test("a non-tradable discoteca entry rolls back the whole trade (including the other side's card)", async () => {
    await reset();
    await db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 1 });
    await db.insert(userDiscoteca).values({ userId: userBId, entryId: entryYId, count: 1, tradable: false });

    const err = await captureRejection(CardsDB.executeMixedTrade(
      userAId, [{ cardId: cardXId, count: 1 }], [],
      userBId, [], [{ entryId: entryYId, count: 1 }],
      1,
    ));
    expect(err).toBeInstanceOf(InsufficientDiscotecaEntryError);

    expect(await ownedCardCount(userAId, cardXId)).toBe(1); // A's card decrement rolled back too
    expect(await ownedEntryCount(userBId, entryYId)).toBe(1);
  });

  test("insufficient card count on one side rolls back an already-decremented discoteca entry on the other", async () => {
    await reset();
    await db.insert(userDiscoteca).values({ userId: userAId, entryId: entryXId, count: 1, tradable: true });
    // userB does NOT have cardY

    const err = await captureRejection(CardsDB.executeMixedTrade(
      userAId, [], [{ entryId: entryXId, count: 1 }],
      userBId, [{ cardId: cardYId, count: 1 }], [],
      1,
    ));
    expect(err).toBeInstanceOf(InsufficientCardError);

    expect(await ownedEntryCount(userAId, entryXId)).toBe(1);
  });

  test("swaps a partial discoteca count, leaving the remainder owned", async () => {
    await reset();
    await db.insert(userDiscoteca).values({ userId: userAId, entryId: entryXId, count: 5, tradable: true });
    await db.insert(userCards).values({ userId: userBId, cardId: cardYId, count: 1 });

    await CardsDB.executeMixedTrade(
      userAId, [], [{ entryId: entryXId, count: 2 }],
      userBId, [{ cardId: cardYId, count: 1 }], [],
      1,
    );

    expect(await ownedEntryCount(userAId, entryXId)).toBe(3);
    expect(await ownedEntryCount(userBId, entryXId)).toBe(2);
  });

  test("rejects an offer that lists the same discoteca entry twice", async () => {
    await reset();
    await db.insert(userDiscoteca).values({ userId: userAId, entryId: entryXId, count: 3, tradable: true });

    const err = await captureRejection(CardsDB.executeMixedTrade(
      userAId, [], [{ entryId: entryXId, count: 1 }, { entryId: entryXId, count: 2 }],
      userBId, [{ cardId: cardYId, count: 1 }], [],
      1,
    ));
    expect((err as Error)?.message).toContain('same discoteca entry twice');
  });

  test("rejects a non-positive discoteca count", async () => {
    const err = await captureRejection(CardsDB.executeMixedTrade(
      userAId, [], [{ entryId: entryXId, count: 0 }],
      userBId, [{ cardId: cardYId, count: 1 }], [],
      1,
    ));
    expect((err as Error)?.message).toContain('must be positive');
  });

  test("trading both cards and discoteca entries on both sides in one trade", async () => {
    await reset();
    await db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 1 });
    await db.insert(userDiscoteca).values({ userId: userAId, entryId: entryXId, count: 1, tradable: true });
    await db.insert(userCards).values({ userId: userBId, cardId: cardYId, count: 1 });
    await db.insert(userDiscoteca).values({ userId: userBId, entryId: entryYId, count: 1, tradable: true });

    await CardsDB.executeMixedTrade(
      userAId, [{ cardId: cardXId, count: 1 }], [{ entryId: entryXId, count: 1 }],
      userBId, [{ cardId: cardYId, count: 1 }], [{ entryId: entryYId, count: 1 }],
      1,
    );

    expect(await ownedCardCount(userBId, cardXId)).toBe(1);
    expect(await ownedEntryCount(userBId, entryXId)).toBe(1);
    expect(await ownedCardCount(userAId, cardYId)).toBe(1);
    expect(await ownedEntryCount(userAId, entryYId)).toBe(1);
  });
});
