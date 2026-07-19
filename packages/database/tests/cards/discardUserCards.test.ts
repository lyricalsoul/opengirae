import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, userCards, rarities } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";
import { CARD_DISCARD_REWARDS } from "../../constants";

describe("CardsDB.discardUserCards", () => {
  let userId: number;
  let comumRarityId: number, raroRarityId: number;
  let ownedCardAId: number, ownedCardBId: number, unownedCardId: number;

  beforeAll(async () => {
    const [comum] = await db.select().from(rarities).where(eq(rarities.name, "Comum")).limit(1);
    const [raro] = await db.select().from(rarities).where(eq(rarities.name, "Raro")).limit(1);
    comumRarityId = comum!.id;
    raroRarityId = raro!.id;

    const [user] = await db.insert(users).values({
      displayName: "Test Bulk Discard", avatarUrl: "", coins: 0,
    }).returning();
    userId = user!.id;

    const [a, b, c] = await db.insert(cards).values([
      { name: "Test Bulk A", rarityId: comumRarityId },
      { name: "Test Bulk B", rarityId: raroRarityId },
      { name: "Test Bulk Unowned", rarityId: comumRarityId },
    ]).returning();
    ownedCardAId = a!.id;
    ownedCardBId = b!.id;
    unownedCardId = c!.id;
  });

  afterAll(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cards).where(inArray(cards.id, [ownedCardAId, ownedCardBId, unownedCardId]));
    await db.delete(users).where(eq(users.id, userId));
  });

  beforeEach(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.update(users).set({ coins: 0 }).where(eq(users.id, userId));
    await db.insert(userCards).values([
      { userId, cardId: ownedCardAId, count: 1 },
      { userId, cardId: ownedCardBId, count: 1 },
    ]);
  });

  test("discards every owned card in one batch and sums the reward", async () => {
    const result = await CardsDB.discardUserCards(userId, [ownedCardAId, ownedCardBId]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.totalCoinsAwarded).toBe(CARD_DISCARD_REWARDS.Comum! + CARD_DISCARD_REWARDS.Raro!);
    expect(result.results).toHaveLength(2);

    const remaining = await db.select().from(userCards).where(eq(userCards.userId, userId));
    expect(remaining).toHaveLength(0);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(CARD_DISCARD_REWARDS.Comum! + CARD_DISCARD_REWARDS.Raro!);
  });

  test("one not-owned card aborts the ENTIRE batch - no discards, no coins", async () => {
    const result = await CardsDB.discardUserCards(userId, [ownedCardAId, ownedCardBId, unownedCardId]);
    expect(result).toEqual({ ok: false, reason: 'missing_or_not_owned', cardId: unownedCardId });

    const remaining = await db.select().from(userCards).where(eq(userCards.userId, userId));
    expect(remaining).toHaveLength(2);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(0);
  });

  test("a nonexistent card id also aborts the entire batch", async () => {
    const result = await CardsDB.discardUserCards(userId, [ownedCardAId, 999999999]);
    expect(result).toEqual({ ok: false, reason: 'missing_or_not_owned', cardId: 999999999 });

    const remaining = await db.select().from(userCards).where(eq(userCards.userId, userId));
    expect(remaining).toHaveLength(2);
  });

  test("a repeated card id discards that many copies, not the id once", async () => {
    await db.update(userCards).set({ count: 3 }).where(eq(userCards.userId, userId));

    const result = await CardsDB.discardUserCards(userId, [ownedCardAId, ownedCardAId]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.totalCoinsAwarded).toBe(CARD_DISCARD_REWARDS.Comum! * 2);
    expect(result.results).toEqual([{ cardId: ownedCardAId, remainingCount: 1, coinsAwarded: CARD_DISCARD_REWARDS.Comum! * 2 }]);

    const [remaining] = await db.select().from(userCards).where(eq(userCards.cardId, ownedCardAId));
    expect(remaining!.count).toBe(1);
  });

  test("requesting more copies than owned aborts the entire batch", async () => {
    // beforeEach seeds count: 1 for both cards - asking for 2 copies of A must fail
    const result = await CardsDB.discardUserCards(userId, [ownedCardAId, ownedCardAId, ownedCardBId]);
    expect(result).toEqual({ ok: false, reason: 'missing_or_not_owned', cardId: ownedCardAId });

    const remaining = await db.select().from(userCards).where(eq(userCards.userId, userId));
    expect(remaining).toHaveLength(2);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(0);
  });
});
