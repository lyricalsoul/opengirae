import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, bootstrapCommandeerWorkers, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import { executeCommand } from "../../services/commands";
import EmojicardCommand from "../../commands/cards/emojicard";

const { sentMessages } = mockTelegram();

async function waitForSentMessage(minLength: number, timeoutMs = 5000): Promise<void> {
  const startTime = Date.now();
  while (sentMessages.length < minLength) {
    if (Date.now() - startTime > timeoutMs) throw new Error(`Timeout waiting for sentMessages.length >= ${minLength}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

describe("/emojicard", () => {
  const fx = new TestFixtures();
  let authorId: string;
  let userId: number;
  let cardId: number;
  let card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>;

  beforeAll(async () => {
    await bootstrapCommandeerWorkers();

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

  test("remover clears a previously set custom emoji", async () => {
    const ctx = fakeCtx({ name: 'emojicard', authorId, args: ['remover', String(cardId)] });
    await EmojicardCommand.execute(ctx, { card, emoji: '🎉' });
    expect((await CardsDB.getUserCard(userId, cardId))?.customEmoji).toBe('🎉');

    await EmojicardCommand.remover(ctx, { card });
    expect((await CardsDB.getUserCard(userId, cardId))?.customEmoji).toBeNull();
  });

  test("remover on a card the user doesn't own replies without throwing", async () => {
    const otherCardId = (await fx.card({ name: "Test Emojicard Unowned Card" })).id;
    const otherCard = (await CardsDB.getCardWithDetails(otherCardId))!;
    const ctx = fakeCtx({ name: 'emojicard', authorId, args: ['remover', String(otherCardId)] });
    await EmojicardCommand.remover(ctx, { card: otherCard }); // no throw = pass; see 03-commands.md on why not `expect(promise).resolves...`
  });

  test("real dispatch: '/emojicard remover <id>' resolves the card ID through the CARD argument type and clears it", async () => {
    await CardsDB.setUserCardCustomEmoji(userId, cardId, '🎉');
    expect((await CardsDB.getUserCard(userId, cardId))?.customEmoji).toBe('🎉');

    const startIndex = sentMessages.length;
    const ctx = fakeCtx({ name: 'emojicard', authorId, args: ['remover', String(cardId)], platform: 'none' });
    await executeCommand(ctx);
    await waitForSentMessage(startIndex + 1);

    expect((await CardsDB.getUserCard(userId, cardId))?.customEmoji).toBeNull();
    const msg = sentMessages[sentMessages.length - 1]!;
    const content = msg.text ?? msg.content ?? "";
    expect(content).toContain("Removi o emoji personalizado");
  });
});
