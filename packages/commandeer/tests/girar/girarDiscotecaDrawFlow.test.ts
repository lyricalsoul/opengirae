import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, TestFixtures, fakeCtx, waitFor } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { userDiscoteca } from "@girae/database/schemas/discoteca";
import { DiscotecaDB } from "@girae/database/discoteca";
import { SettingsDB } from "@girae/database/settings";
import { eq, and } from "drizzle-orm";
import { rawClient, commandQueue } from "@girae/common/queue";
import { processCallback } from "@girae/common/inbound/callback";

const { sentMessages } = mockTelegram();

describe("girar Discoteca draw flow (real workers)", () => {
  const fx = new TestFixtures();
  let userId: number;
  let entryId: number;
  let telegramId: string;
  let subcategoryName: string;

  beforeAll(async () => {
    await bootstrapCommandeerWorkers();

    telegramId = `test-girar-discoteca-${Date.now()}`;
    userId = (await fx.user({ displayName: "Test Girar Discoteca", platform: 'telegram', platformId: telegramId })).id;

    const genreId = (await fx.discotecaGenre({ name: `Test Girar Discoteca Genre ${Date.now()}` })).id;
    subcategoryName = `Test Girar Discoteca Albums ${Date.now()}`;
    const subcategoryId = (await fx.discotecaSubcategory({ genreId, isAlbum: true, name: subcategoryName, emoji: '💽' })).id;
    const artistId = (await fx.discotecaArtist()).id;
    entryId = (await fx.discotecaEntry({ artistId, type: 'album', name: `Test Girar Discoteca Entry ${Date.now()}` })).id;
    await DiscotecaDB.setEntryGenres(entryId, [subcategoryId]);
  });

  afterAll(async () => {
    await rawClient.del(`girar:active:${telegramId}:chat-${telegramId}`);
    await db.delete(userDiscoteca).where(eq(userDiscoteca.userId, userId));
    await fx.cleanup();
  });

  const chatId = () => `chat-${telegramId}`;

  const findSent = (startIndex: number, pred: (m: typeof sentMessages[number]) => boolean) =>
    () => sentMessages.slice(startIndex).find(pred);

  test("draws an album, grants it, and spends a giro", async () => {
    const startIndex = sentMessages.length;

    await commandQueue.add('executeCommand', fakeCtx({
      name: 'girar',
      authorId: telegramId,
      platform: 'telegram',
      chatId: chatId(),
      workflowID: `wf-discoteca-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    }));

    const categoryPrompt = await waitFor(findSent(startIndex, m => typeof m.text === 'string' && m.text.includes('Escolha uma categoria')), { label: 'category prompt' });
    const discotecaButton = categoryPrompt.replyMarkup?.inline_keyboard?.flat().find((b: any) => b.text?.includes('Discoteca'));
    expect(discotecaButton).toBeDefined();

    await processCallback(discotecaButton!.callback_data, telegramId, `test-click-disco-cat-${Date.now()}`, 'telegram', chatId(), 'cat-msg-id');

    const genrePrompt = await waitFor(findSent(startIndex, m => m.method === 'editMessageText' && typeof m.text === 'string' && m.text.includes('Escolha um gênero')), { label: 'genre prompt' });
    // the draw samples a few genres out of every album/single genre in the db, so the fixture genre isn't guaranteed to be offered - any offered one proves the flow
    const genreButton = genrePrompt.replyMarkup?.inline_keyboard?.flat().find((b: any) => b.callback_data);
    expect(genreButton).toBeDefined();

    await processCallback(genreButton!.callback_data, telegramId, `test-click-genre-${Date.now()}`, 'telegram', chatId(), 'genre-msg-id');

    // editMessageMedia bypasses the telegramsjs mock via a raw fetch(), so assert on db state instead.
    const owned = await waitFor(async () => {
      const rows = await db.select({ count: userDiscoteca.count }).from(userDiscoteca).where(eq(userDiscoteca.userId, userId));
      return rows.length > 0 ? rows : undefined;
    }, { label: 'a discoteca entry granted to the user' });
    expect(owned.reduce((sum, r) => sum + r.count, 0)).toBe(1);

    const [user] = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId));
    expect(user?.usedDraws).toBe(1);
  }, 15000);

  test("the Discoteca row is hidden from /girar when disabled in settings", async () => {
    const otherTelegramId = `test-girar-discoteca-disabled-${Date.now()}`;
    await fx.user({ displayName: "Test Girar Discoteca Disabled", platform: 'telegram', platformId: otherTelegramId });
    const otherChatId = `chat-${otherTelegramId}`;

    await SettingsDB.setDiscotecaEnabled(false);
    try {
      const startIndex = sentMessages.length;

      await commandQueue.add('executeCommand', fakeCtx({
        name: 'girar',
        authorId: otherTelegramId,
        platform: 'telegram',
        chatId: otherChatId,
        workflowID: `wf-discoteca-disabled-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      }));

      const categoryPrompt = await waitFor(findSent(startIndex, m => typeof m.text === 'string' && m.text.includes('Escolha uma categoria')), { label: 'category prompt' });
      const discotecaButton = categoryPrompt!.replyMarkup?.inline_keyboard?.flat()
        .find((b: any) => b.text?.includes('Discoteca'));
      expect(discotecaButton).toBeUndefined();
    } finally {
      await SettingsDB.setDiscotecaEnabled(true);
      await rawClient.del(`girar:active:${otherTelegramId}:${otherChatId}`);
    }
  }, 15000);
});
