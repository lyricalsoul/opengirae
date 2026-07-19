import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, userCards, trades, rarities } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB, InsufficientCardError } from "../../cards";

const TEST_TIMEOUT_MS = 20000; // network round-trips to a remote dev DB, not local

// Real concurrent races against the live DB - the class of bug a sequential test
// can't catch. Every assertion here cares about "what's the final state after two
// things happened at once," not just "did the function return the right value."
// Every test cleans up in a finally - a failed assertion must never leak rows that
// break a *different* test's foreign keys.
describe("CardsDB.executeTrade - concurrency", () => {
  let rarityId: number;
  let userAId: number, userBId: number, userCId: number;
  let cardXId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [a, b, c] = await db.insert(users).values([
      { displayName: "Race A", avatarUrl: "" },
      { displayName: "Race B", avatarUrl: "" },
      { displayName: "Race C", avatarUrl: "" },
    ]).returning();
    userAId = a!.id;
    userBId = b!.id;
    userCId = c!.id;

    const [x] = await db.insert(cards).values([{ name: "Test Race Card X", rarityId }]).returning();
    cardXId = x!.id;
  });

  afterAll(async () => {
    await db.delete(trades).where(inArray(trades.user1Id, [userAId, userBId, userCId]));
    await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId, userCId]));
    await db.delete(cards).where(eq(cards.id, cardXId));
    await db.delete(users).where(inArray(users.id, [userAId, userBId, userCId]));
  });

  beforeEach(async () => {
    await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId, userCId]));
  });

  async function ownedCount(userId: number, cardId: number = cardXId): Promise<number> {
    return db.select().from(userCards)
      .where(eq(userCards.userId, userId))
      .then(rows => rows.find(r => r.cardId === cardId)?.count ?? 0);
  }

  test("only one of two simultaneous trades can spend the same single copy", async () => {
    // userA has exactly ONE copy of cardX. Two different trades (with B and with C)
    // both try to trade that same single copy away at the same instant - simulates
    // two /card "add to trade" clicks racing across two separate active trades, or a
    // double-tap on the finalize button hitting two in-flight workflow executions.
    const [dummyForB, dummyForC] = await Promise.all([
      db.insert(cards).values({ name: `dummy-${Date.now()}-b`, rarityId }).returning().then(r => r[0]!),
      db.insert(cards).values({ name: `dummy-${Date.now()}-c`, rarityId }).returning().then(r => r[0]!),
    ]);

    try {
      await Promise.all([
        db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 1 }),
        db.insert(userCards).values({ userId: userBId, cardId: dummyForB.id, count: 1 }),
        db.insert(userCards).values({ userId: userCId, cardId: dummyForC.id, count: 1 }),
      ]);

      const results = await Promise.allSettled([
        CardsDB.executeTrade(userAId, [{ cardId: cardXId, count: 1 }], userBId, [{ cardId: dummyForB.id, count: 1 }]),
        CardsDB.executeTrade(userAId, [{ cardId: cardXId, count: 1 }], userCId, [{ cardId: dummyForC.id, count: 1 }]),
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // exactly one trade wins - never both (that would be a duplicated card out of
      // thin air) and never neither (that would mean the guard is too aggressive)
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCardError);

      // userA ends up with zero copies of cardX either way - not negative, not duplicated
      expect(await ownedCount(userAId)).toBe(0);

      // exactly one of B/C received the card, never both
      const bGotIt = await ownedCount(userBId);
      const cGotIt = await ownedCount(userCId);
      expect(bGotIt + cGotIt).toBe(1);
    } finally {
      await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId, userCId]));
      await db.delete(cards).where(inArray(cards.id, [dummyForB.id, dummyForC.id]));
    }
  }, TEST_TIMEOUT_MS);

  test("N simultaneous attempts to overspend a small stack never oversell it", async () => {
    // userA has 3 copies. Fire 5 concurrent trades each trying to take 1 - at most 3
    // can succeed, the rest must cleanly fail, and the final count must be exactly 0
    // (never negative, never left with phantom copies).
    const N = 5;
    const setup = await Promise.all(
      Array.from({ length: N }, (_, i) => Promise.all([
        db.insert(users).values({ displayName: `Oversell ${i}`, avatarUrl: "" }).returning().then(r => r[0]!),
        db.insert(cards).values({ name: `dummy-oversell-${Date.now()}-${i}`, rarityId }).returning().then(r => r[0]!),
      ]))
    );
    const partners = setup.map(([u]) => u.id);
    const dummyCardIds = setup.map(([, c]) => c.id);

    try {
      await Promise.all([
        db.insert(userCards).values({ userId: userAId, cardId: cardXId, count: 3 }),
        ...setup.map(([u, c]) => db.insert(userCards).values({ userId: u.id, cardId: c.id, count: 1 })),
      ]);

      const results = await Promise.allSettled(
        partners.map((partnerId, i) =>
          CardsDB.executeTrade(userAId, [{ cardId: cardXId, count: 1 }], partnerId, [{ cardId: dummyCardIds[i]!, count: 1 }])
        )
      );

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      expect(succeeded).toBe(3); // exactly as many as userA actually had
      expect(await ownedCount(userAId)).toBe(0); // never negative

      const totalReceivedByPartners = await db.select().from(userCards)
        .where(inArray(userCards.userId, partners))
        .then(rows => rows.filter(r => r.cardId === cardXId).reduce((sum, r) => sum + r.count, 0));
      expect(totalReceivedByPartners).toBe(3); // exactly 3 copies changed hands, none duplicated
    } finally {
      // trades history rows reference partners as user2Id - must go before deleting
      // the users, and before the outer afterAll (which only runs once, at the end)
      await db.delete(trades).where(inArray(trades.user2Id, partners));
      // both directions: winning trades leave userA owning some partners' dummy
      // cards, AND leave some partners owning a copy of cardX (the shared fixture)
      await db.delete(userCards).where(inArray(userCards.cardId, dummyCardIds));
      await db.delete(userCards).where(inArray(userCards.userId, partners));
      await db.delete(cards).where(inArray(cards.id, dummyCardIds));
      await db.delete(users).where(inArray(users.id, partners));
    }
  }, TEST_TIMEOUT_MS);
});
