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
    userId = (await fx.user({ displayName: "Test Emojicard", platform: 'none', platformId: authorId })).id;
    cardId = (await fx.card({ name: "Test Emojicard Card" })).id;
    await fx.ownCard(userId, cardId, 1);
    card = (await CardsDB.getCardWithDetails(cardId))!;
  });

  afterAll(() => fx.cleanup());

  test("sets the custom emoji on the owned card", async () => {
    const ctx = fakeCtx({ name: 'emojicard', authorId, args: [String(cardId), '🎉'] });
    await EmojicardCommand.execute(ctx, { card, emoji: '🎉' });

    const owned = await CardsDB.getUserCard(userId, cardId);
    expect(owned?.customEmoji).toBe('🎉');
  });
});
