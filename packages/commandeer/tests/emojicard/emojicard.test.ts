import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import EmojicardCommand from "../../commands/all/emojicard.cards";

mockTelegram();

describe("/emojicard", () => {
  const fx = new TestFixtures();
  let authorId: string;
  let userId: number;
  let cardId: number;
  let card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    authorId = `test-emojicard-${Bun.randomUUIDv7()}`;
    const rarityId = (await fx.rarity({ name: "Test Emojicard Rarity", cativeiroThreshold: 5 })).id;
    userId = (await fx.user({ displayName: "Test Emojicard", platform: 'none', platformId: authorId })).id;
    cardId = (await fx.card({ name: "Test Emojicard Card", rarityId })).id;
    await fx.ownCard(userId, cardId, 5);
    card = (await CardsDB.getCardWithDetails(cardId))!;
  });

  afterAll(() => fx.cleanup());

  test("sets the custom emoji on the owned card", async () => {
    const ctx = fakeCtx({ name: 'emojicard', authorId, args: [String(cardId), '🎉'] });
    await EmojicardCommand.execute(ctx, { card, emoji: '🎉' });

    const owned = await CardsDB.getUserCard(userId, cardId);
    expect(owned?.customEmoji).toBe('🎉');
  });

  test("no longer eligible (dropped below threshold since the guard ran) replies with a friendly message instead of writing", async () => {
    const { db } = await import("@girae/database/index");
    const { userCards } = await import("@girae/database/schemas/cards");
    const { eq, and } = await import("drizzle-orm");
    await db.update(userCards).set({ count: 1, customEmoji: null }).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));

    try {
      const ctx = fakeCtx({ name: 'emojicard', authorId, args: [String(cardId), '🎉'] });
      await EmojicardCommand.execute(ctx, { card, emoji: '🎉' });

      const owned = await CardsDB.getUserCard(userId, cardId);
      expect(owned?.customEmoji).toBeNull();
    } finally {
      await db.update(userCards).set({ count: 5 }).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    }
  });
});
