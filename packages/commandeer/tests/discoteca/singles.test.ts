import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, anyRarityId, lastReply, waitFor } from "@girae/tests";
import { DiscotecaDB } from "@girae/database/discoteca";
import { CardsDB } from "@girae/database/cards";
import { EconomyDB } from "@girae/database/economy";
import { CommandArgumentType, type CommandArgumentSpec } from "@girae/common/commands";
import { resolveCommandArguments } from "../../services/commandArguments";
import { db } from "@girae/database/index";
import { discotecaEntries } from "@girae/database/schemas/discoteca";
import { userCards } from "@girae/database/schemas/cards";
import { inArray, and, eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import SinglesCommand from "../../commands/discoteca/singles";

const { sentMessages } = mockTelegram();

describe("/singles", () => {
  const fx = new TestFixtures();
  let userPlatformId: string;
  let userId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    userPlatformId = `test-singles-user-${Date.now()}`;
    userId = (await fx.user({ displayName: "Test Singles User", platform: 'telegram', platformId: userPlatformId })).id;
  });

  afterAll(() => fx.cleanup());

  test("no argument: lists singles, not albums", async () => {
    // the dev DB accumulates entries across test runs, so the freshly-created single may land
    // past page 1 - only assert the type-scoping (no album ever leaks in), not page-1 presence.
    const artistId = (await fx.discotecaArtist()).id;
    const rarityId = await anyRarityId();
    const albumId = (await DiscotecaDB.createEntry({
      name: `Test Singles List Album ${Date.now()}`, artistId, appleMusicId: `test-singles-list-album-${Date.now()}`, type: 'album', rarityId,
    }))!.id;
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(inArray(discotecaEntries.id, [albumId])); });

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'singles', authorId: userPlatformId, args: [], platform: 'telegram' });
    await SinglesCommand.execute(ctx, { query: undefined });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain('Singles da discoteca');
    expect(text).not.toContain(`<code>${albumId}</code>`);
  });

  test("with a name matching only an album: not found (type-scoped)", async () => {
    const artistId = (await fx.discotecaArtist()).id;
    const albumId = (await DiscotecaDB.createEntry({
      name: `Test Singles AlbumOnly ${Date.now()}`, artistId, appleMusicId: `test-singles-albumonly-${Date.now()}`, type: 'album',
      rarityId: await anyRarityId(),
    }))!.id;
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(inArray(discotecaEntries.id, [albumId])); });

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'singles', authorId: userPlatformId, args: ['Test Singles AlbumOnly'], platform: 'telegram' });
    const specs: CommandArgumentSpec[] = [{ name: 'query', type: CommandArgumentType.DISCOTECA_ENTRY, entryType: 'single', nullable: true }];
    const result = await resolveCommandArguments(specs, ctx, '/singles [busca]');
    expect(result).toBeNull();

    const last = sentMessages[sentMessages.length - 1]!;
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain('Não encontrei um single');
  });

  test("with an argument matching a single: shows the entry detail view (reused from /disco)", async () => {
    const artistId = (await fx.discotecaArtist({ name: `Test Singles Detail Artist ${Date.now()}` })).id;
    const singleId = (await DiscotecaDB.createEntry({
      name: `Test Singles Detail Single ${Date.now()}`, artistId, appleMusicId: `test-singles-detail-${Date.now()}`, type: 'single',
      rarityId: await anyRarityId(),
    }))!.id;
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(inArray(discotecaEntries.id, [singleId])); });
    const entry = await DiscotecaDB.getEntryWithDetails(singleId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'singles', authorId: userPlatformId, args: [], platform: 'telegram' });
    await SinglesCommand.execute(ctx, { query: entry! });
    const last = await lastReply(sentMessages);
    expect(last.method).toBe('sendMessage');
  });

  test("with an argument matching an entry whose artist has a linked card: shows the card's category emoji, id and owned count", async () => {
    const musicCategoryId = (await CardsDB.getCategoryByName('Música') ?? await CardsDB.createCategory('Música', '🎸'))!.id;
    const subcategoryId = (await fx.subcategory({ categoryId: musicCategoryId, name: `Test Singles Sub ${Date.now()}` })).id;
    const cardId = (await fx.card({ name: `Test Singles Card ${Date.now()}`, subcategoryId })).id;
    fx.onCleanup(async () => { await db.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId))); });

    const artistId = (await fx.discotecaArtist({ name: `Test Singles Carded Artist ${Date.now()}` })).id;
    await DiscotecaDB.setArtistCard(artistId, cardId);
    await CardsDB.addUserCard(userId, cardId, await EconomyDB.getIncomeInflationRate());

    const entryId = (await fx.discotecaEntry({ artistId, type: 'single' })).id;
    const entry = await DiscotecaDB.getEntryWithDetails(entryId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'singles', authorId: userPlatformId, args: [], platform: 'telegram' });
    await SinglesCommand.execute(ctx, { query: entry! });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain(`<code>${cardId}</code>`);
    expect(text).toContain('x1');
  });

  test("with an argument matching a single with a cached preview (file ref): sends audio with performer/title and caches the file_id", async () => {
    const artistName = `Test Singles Preview Artist ${Date.now()}`;
    const artistId = (await fx.discotecaArtist({ name: artistName })).id;
    const entryName = `Test Singles Preview Single ${Date.now()}`;
    const dir = await mkdtemp(join(tmpdir(), 'singles-test-scratch-'));
    const prevScratch = process.env.SCRATCH_DIR;
    process.env.SCRATCH_DIR = dir;
    await Bun.write(join(dir, 'preview.m4a'), new Uint8Array([1, 2, 3]));

    const entryRow = await DiscotecaDB.createEntry({
      name: entryName, artistId, appleMusicId: `test-singles-preview-${Date.now()}`, type: 'single',
      rarityId: await anyRarityId(),
      previewUrl: "file://scratch/preview.m4a",
    });
    fx.onCleanup(async () => {
      await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entryRow!.id));
      process.env.SCRATCH_DIR = prevScratch;
      await rm(dir, { recursive: true, force: true });
    });

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'singles', authorId: userPlatformId, args: [], platform: 'telegram' });
    await SinglesCommand.execute(ctx, { query: (await DiscotecaDB.getEntryWithDetails(entryRow!.id))! });
    const last = await lastReply(sentMessages);
    expect(last.method).toBe('sendAudio');
    expect(last.performer).toBe(artistName);
    expect(last.title).toBe(entryName);

    // second view should now hit the cached file_id, not the scratch file
    // persisted by the answerer after the send completes, not before the reply is captured
    const updated = await waitFor(async () => {
      const row = await DiscotecaDB.getEntryWithDetails(entryRow!.id);
      return row?.telegramFileId ? row : undefined;
    }, { label: 'telegramFileId cached' });

    await rm(join(dir, 'preview.m4a'));
    sentMessages.length = 0;
    await SinglesCommand.execute(ctx, { query: updated });
    const secondSend = await lastReply(sentMessages);
    expect(secondSend.method).toBe('sendAudio');
    expect(secondSend.audio).toBe(updated!.telegramFileId);
  });

  test("with an argument matching a single with no cached preview: falls back to text, no audio call", async () => {
    const artistId = (await fx.discotecaArtist()).id;
    const entryId = (await fx.discotecaEntry({ artistId, type: 'single' })).id;
    const entry = await DiscotecaDB.getEntryWithDetails(entryId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'singles', authorId: userPlatformId, args: [], platform: 'telegram' });
    await SinglesCommand.execute(ctx, { query: entry! });
    const last = await lastReply(sentMessages);
    expect(last.method).toBe('sendMessage');
  });
});
