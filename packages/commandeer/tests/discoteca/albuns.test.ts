import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, anyRarityId, lastReply } from "@girae/tests";
import { DiscotecaDB } from "@girae/database/discoteca";
import { CardsDB } from "@girae/database/cards";
import { CommandArgumentType, type CommandArgumentSpec } from "@girae/common/commands";
import { resolveCommandArguments } from "../../services/commandArguments";
import { db } from "@girae/database/index";
import { discotecaEntries } from "@girae/database/schemas/discoteca";
import { inArray, eq } from "drizzle-orm";
import AlbunsCommand from "../../commands/discoteca/albuns";

const { sentMessages } = mockTelegram();

describe("/albuns", () => {
  const fx = new TestFixtures();
  let userPlatformId: string;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    userPlatformId = `test-albuns-user-${Date.now()}`;
    await fx.user({ displayName: "Test Albuns User", platform: 'telegram', platformId: userPlatformId });
  });

  afterAll(() => fx.cleanup());

  test("no argument: lists albums, not singles", async () => {
    // the dev DB accumulates entries across test runs, so the freshly-created album may land
    // past page 1 - only assert the type-scoping (no single ever leaks in), not page-1 presence.
    const artistId = (await fx.discotecaArtist()).id;
    const rarityId = await anyRarityId();
    const singleId = (await DiscotecaDB.createEntry({
      name: `Test Albuns List Single ${Date.now()}`, artistId, appleMusicId: `test-albuns-list-single-${Date.now()}`, type: 'single', rarityId,
    }))!.id;
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(inArray(discotecaEntries.id, [singleId])); });

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'albuns', authorId: userPlatformId, args: [], platform: 'telegram' });
    await AlbunsCommand.execute(ctx, { query: undefined });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain('Álbuns da discoteca');
    expect(text).not.toContain(`<code>${singleId}</code>`);
  });

  test("with a name matching only a single: not found (type-scoped)", async () => {
    const artistId = (await fx.discotecaArtist()).id;
    const singleId = (await DiscotecaDB.createEntry({
      name: `Test Albuns SingleOnly ${Date.now()}`, artistId, appleMusicId: `test-albuns-singleonly-${Date.now()}`, type: 'single',
      rarityId: await anyRarityId(),
    }))!.id;
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(inArray(discotecaEntries.id, [singleId])); });

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'albuns', authorId: userPlatformId, args: ['Test Albuns SingleOnly'], platform: 'telegram' });
    const specs: CommandArgumentSpec[] = [{ name: 'query', type: CommandArgumentType.DISCOTECA_ENTRY, entryType: 'album', nullable: true }];
    const result = await resolveCommandArguments(specs, ctx, '/albuns [busca]');
    expect(result).toBeNull();

    const last = sentMessages[sentMessages.length - 1]!;
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain('Não encontrei um álbum');
  });

  test("with an argument matching an album: shows the entry detail view (reused from /disco)", async () => {
    const artistId = (await fx.discotecaArtist({ name: `Test Albuns Detail Artist ${Date.now()}` })).id;
    const albumId = (await DiscotecaDB.createEntry({
      name: `Test Albuns Detail Album ${Date.now()}`, artistId, appleMusicId: `test-albuns-detail-${Date.now()}`, type: 'album',
      rarityId: await anyRarityId(),
      artworkUrl: "https://example.com/art.jpg",
    }))!.id;
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(inArray(discotecaEntries.id, [albumId])); });
    const entry = await DiscotecaDB.getEntryWithDetails(albumId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'albuns', authorId: userPlatformId, args: [], platform: 'telegram' });
    await AlbunsCommand.execute(ctx, { query: entry! });
    const last = await lastReply(sentMessages);
    expect(last.method).toBe('sendPhoto');
  });

  test("with an argument matching an album: shows its linked singles and sends a photo", async () => {
    const artistId = (await fx.discotecaArtist({ name: `Test Albuns LinkedSingles Artist ${Date.now()}` })).id;
    const albumRow = await DiscotecaDB.createEntry({
      name: `Test Albuns LinkedSingles Album ${Date.now()}`, artistId, appleMusicId: `test-albuns-linkedsingles-${Date.now()}`, type: 'album',
      rarityId: await anyRarityId(),
      artworkUrl: "https://example.com/art.jpg",
      appleMusicUrl: "https://music.apple.com/us/album/test",
    });
    const albumId = albumRow!.id;
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, albumId)); });

    const singleName = `Test Albuns Linked Single ${Date.now()}`;
    const singleRow = await DiscotecaDB.createEntry({
      name: singleName, artistId, appleMusicId: `test-albuns-linked-single-${Date.now()}`, type: 'single',
      rarityId: await anyRarityId(),
      albumId,
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, singleRow!.id)); });

    const entry = await DiscotecaDB.getEntryWithDetails(albumId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'albuns', authorId: userPlatformId, args: [], platform: 'telegram' });
    await AlbunsCommand.execute(ctx, { query: entry! });
    const last = await lastReply(sentMessages);
    expect(last.method).toBe('sendPhoto');
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain(singleName);
    expect(text).toContain('💽');
    expect(last.replyMarkup?.inline_keyboard?.[0]?.[0]?.url).toBe("https://music.apple.com/us/album/test");
  });

  test("with an argument matching an entry whose artist has a linked card the viewer doesn't own: no owned-count shown", async () => {
    const musicCategoryId = (await CardsDB.getCategoryByName('Música') ?? await CardsDB.createCategory('Música', '🎸'))!.id;
    const subcategoryId = (await fx.subcategory({ categoryId: musicCategoryId, name: `Test Albuns Unowned Card Sub ${Date.now()}` })).id;
    const cardId = (await fx.card({ name: `Test Albuns Unowned Card ${Date.now()}`, subcategoryId })).id;

    const artistId = (await fx.discotecaArtist({ name: `Test Albuns Uncarded Artist ${Date.now()}` })).id;
    await DiscotecaDB.setArtistCard(artistId, cardId);

    const entryId = (await fx.discotecaEntry({ artistId, type: 'album' })).id;
    const entry = await DiscotecaDB.getEntryWithDetails(entryId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'albuns', authorId: userPlatformId, args: [], platform: 'telegram' });
    await AlbunsCommand.execute(ctx, { query: entry! });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain(`<code>${cardId}</code>`);
    expect(text).not.toContain('x0');
  });

  test("with an argument matching an entry with multiple genres: combines them into one italicized line", async () => {
    const artistId = (await fx.discotecaArtist()).id;
    const entryId = (await fx.discotecaEntry({ artistId, type: 'album' })).id;
    const genreAId = (await fx.discotecaGenre({ name: `Alternativo ${Date.now()}` })).id;
    const genreBId = (await fx.discotecaGenre({ name: `Pop ${Date.now()}` })).id;
    const genreCId = (await fx.discotecaGenre({ name: `Rock ${Date.now()}` })).id;
    const subAId = (await fx.discotecaSubcategory({ genreId: genreAId, isAlbum: true })).id;
    const subBId = (await fx.discotecaSubcategory({ genreId: genreBId, isAlbum: true })).id;
    const subCId = (await fx.discotecaSubcategory({ genreId: genreCId, isAlbum: true })).id;
    await DiscotecaDB.setEntryGenres(entryId, [subAId, subBId, subCId]);
    const entry = await DiscotecaDB.getEntryWithDetails(entryId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'albuns', authorId: userPlatformId, args: [], platform: 'telegram' });
    await AlbunsCommand.execute(ctx, { query: entry! });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toMatch(/Álbuns de Alternativo \d+, Pop \d+, e Rock \d+/);
  });

  test("with an argument matching an album with an animated cover: sends it as an animation, not a static photo", async () => {
    const artistId = (await fx.discotecaArtist({ name: `Test Albuns Animated Artist ${Date.now()}` })).id;
    const albumId = (await DiscotecaDB.createEntry({
      name: `Test Albuns Animated Album ${Date.now()}`, artistId, appleMusicId: `test-albuns-animated-${Date.now()}`, type: 'album',
      rarityId: await anyRarityId(),
      artworkUrl: "https://example.com/static-art.jpg",
      animatedArtworkUrl: "https://example.com/animated-art.mp4",
    }))!.id;
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, albumId)); });
    const entry = await DiscotecaDB.getEntryWithDetails(albumId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'albuns', authorId: userPlatformId, args: [], platform: 'telegram' });
    await AlbunsCommand.execute(ctx, { query: entry! });
    const last = await lastReply(sentMessages);
    expect(last.method).toBe('sendAnimation');
    expect(last.animation).toBe('https://example.com/animated-art.mp4');
  });
});
