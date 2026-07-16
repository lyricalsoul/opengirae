import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, userCards, rarities } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";
import { CARD_DISCARD_REWARDS } from "../../constants";

describe("CardsDB.discardUserCard", () => {
  let userId: number;
  let comumRarityId: number, raroRarityId: number;
  let comumCardId: number, raroCardId: number;

  beforeAll(async () => {
    const [comum] = await db.select().from(rarities).where(eq(rarities.name, "Comum")).limit(1);
    const [raro] = await db.select().from(rarities).where(eq(rarities.name, "Raro")).limit(1);
    comumRarityId = comum!.id;
    raroRarityId = raro!.id;

    const [user] = await db.insert(users).values({
      telegramId: `test-discard-${Date.now()}`, displayName: "Test Discard", avatarUrl: "", coins: 0,
    }).returning();
    userId = user!.id;

    const [comumCard, raroCard] = await db.insert(cards).values([
      { name: "Test Discard Comum", rarityId: comumRarityId },
      { name: "Test Discard Raro", rarityId: raroRarityId },
    ]).returning();
    comumCardId = comumCard!.id;
    raroCardId = raroCard!.id;
  });

  afterAll(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cards).where(inArray(cards.id, [comumCardId, raroCardId]));
    await db.delete(users).where(eq(users.id, userId));
  });

  beforeEach(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.update(users).set({ coins: 0 }).where(eq(users.id, userId));
  });

  test("returns null and adds no coins when the user doesn't own the card", async () => {
    const result = await CardsDB.discardUserCard(userId, comumCardId);
    expect(result).toBeNull();

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(0);
  });

  test("discards the last copy, deletes the row, and pays the Comum reward", async () => {
    await db.insert(userCards).values({ userId, cardId: comumCardId, count: 1 });

    const result = await CardsDB.discardUserCard(userId, comumCardId);
    expect(result).toEqual({ remainingCount: 0, coinsAwarded: CARD_DISCARD_REWARDS.Comum! });

    const remaining = await db.select().from(userCards).where(eq(userCards.userId, userId));
    expect(remaining.find(r => r.cardId === comumCardId)).toBeUndefined();

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(CARD_DISCARD_REWARDS.Comum!);
  });

  test("discarding one of several copies decrements instead of deleting, and pays the Raro reward", async () => {
    await db.insert(userCards).values({ userId, cardId: raroCardId, count: 3 });

    const result = await CardsDB.discardUserCard(userId, raroCardId);
    expect(result).toEqual({ remainingCount: 2, coinsAwarded: CARD_DISCARD_REWARDS.Raro! });

    const [row] = await db.select().from(userCards).where(eq(userCards.userId, userId));
    expect(row!.count).toBe(2);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(CARD_DISCARD_REWARDS.Raro!);
  });
});
