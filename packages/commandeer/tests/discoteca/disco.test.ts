import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, anyRarityId, lastReply } from "@girae/tests";
import { DiscotecaDB } from "@girae/database/discoteca";
import { db } from "@girae/database/index";
import { discotecaEntries, userDiscoteca } from "@girae/database/schemas/discoteca";
import { and, eq } from "drizzle-orm";
import DiscoCommand, { resolveEntryMedia } from "../../commands/discoteca/disco";

const { sentMessages } = mockTelegram();

describe("/disco", () => {
  const fx = new TestFixtures();
  let userPlatformId: string;
  let userId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    userPlatformId = `test-disco-user-${Date.now()}`;
    userId = (await fx.user({ displayName: "Test Disco User", platform: 'telegram', platformId: userPlatformId })).id;
  });

  afterAll(() => fx.cleanup());

  test("no argument, nothing owned yet: empty-state message", async () => {
    const ctx = fakeCtx({ name: 'disco', authorId: userPlatformId, args: [], platform: 'telegram' });
    await DiscoCommand.execute(ctx, { query: undefined });
    const last = await lastReply(sentMessages);
    expect(last.text ?? last.caption).toContain('Você ainda não girou nada da discoteca');
  });

  test("no argument, something owned: lists artists including a 0-owned one", async () => {
    const ownedName = `Test Disco Owned Artist ${Date.now()}`;
    const unownedName = `Test Disco Unowned Artist ${Date.now()}`;
    const artistOwnedId = (await fx.discotecaArtist({ name: ownedName })).id;
    const artistUnownedId = (await fx.discotecaArtist({ name: unownedName })).id;
    const ownedEntryId = (await fx.discotecaEntry({ artistId: artistOwnedId })).id;
    await fx.discotecaEntry({ artistId: artistUnownedId });
    await DiscotecaDB.addUserDiscoteca(userId, ownedEntryId);
    fx.onCleanup(async () => { await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, ownedEntryId))); });

    // page boundaries shift with whatever else is in the db, so read every page instead of guessing which one the fresh artists land on
    const first = await DiscoCommand.discoPage(String(userId), 0);
    const pages = [first?.content ?? ''];
    for (let p = 1; p < (first?.totalPages ?? 1); p++) pages.push((await DiscoCommand.discoPage(String(userId), p))?.content ?? '');
    const content = pages.join('\n');

    expect(content).toContain(`\`${artistOwnedId}\`. **${ownedName}** (1/1)`);
    expect(content).toContain(`\`${artistUnownedId}\`. **${unownedName}** (0/1)`);
  });

  test("numeric arg resolves via the linked card id, sends the artist's banner", async () => {
    const artist = await fx.discotecaArtist({ name: "Test Disco Card Artist" });
    const cardId = (await fx.card({ name: `Test Disco Card ${Date.now()}` })).id;
    await DiscotecaDB.setArtistCard(artist.id, cardId);
    await DiscotecaDB.setArtistImage(artist.id, "https://example.com/artist-banner.jpg");
    await fx.discotecaEntry({ name: "Test Disco Album", artistId: artist.id, type: 'album', rarityId: await anyRarityId() });

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'disco', authorId: userPlatformId, args: [String(cardId)], platform: 'telegram' });
    await DiscoCommand.execute(ctx, { query: String(cardId) });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain('Test Disco Album');
    expect(last.photo).toBe("https://example.com/artist-banner.jpg");
  });

  test("fuzzy name search resolves a unique match", async () => {
    await fx.discotecaArtist({ name: "Test Disco Fuzzy Unique Artist" });

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'disco', authorId: userPlatformId, args: ['Fuzzy Unique'], platform: 'telegram' });
    await DiscoCommand.execute(ctx, { query: 'Fuzzy Unique' });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain('Test Disco Fuzzy Unique Artist');
  });

  test("resolveEntryMedia: single with a preview, Telegram - sends audio", async () => {
    const artistId = (await fx.discotecaArtist()).id;
    const entryRow = await DiscotecaDB.createEntry({
      name: `Test Media Single ${Date.now()}`, artistId, appleMusicId: `test-media-single-${Date.now()}`, type: 'single',
      rarityId: await anyRarityId(),
      previewUrl: "file://scratch/preview.m4a",
      artworkUrl: "https://example.com/track-art.jpg",
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entryRow!.id)); });
    const entry = (await DiscotecaDB.getEntryWithDetails(entryRow!.id))!;

    const media = await resolveEntryMedia('telegram', entry);
    expect(media.kind).toBe('audio');
    expect((media as any).audioUrl).toBe("file://scratch/preview.m4a");
  });

  test("resolveEntryMedia: single with a preview, Discord - falls back to its own artwork, never audio", async () => {
    const artistId = (await fx.discotecaArtist()).id;
    const entryRow = await DiscotecaDB.createEntry({
      name: `Test Media Discord Single ${Date.now()}`, artistId, appleMusicId: `test-media-discord-${Date.now()}`, type: 'single',
      rarityId: await anyRarityId(),
      previewUrl: "file://scratch/preview.m4a",
      artworkUrl: "https://example.com/track-art.jpg",
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entryRow!.id)); });
    const entry = (await DiscotecaDB.getEntryWithDetails(entryRow!.id))!;

    const media = await resolveEntryMedia('discord', entry);
    expect(media.kind).toBe('photo');
    expect((media as any).photoUrl).toBe("https://example.com/track-art.jpg");
  });

  test("resolveEntryMedia: single linked to a catalogued album, no preview - uses the album's artwork, not its own", async () => {
    const artistId = (await fx.discotecaArtist({ name: `Test Media AlbumArt Artist ${Date.now()}` })).id;
    const albumRow = await DiscotecaDB.createEntry({
      name: `Test Media AlbumArt Album ${Date.now()}`, artistId, appleMusicId: `test-media-albumart-album-${Date.now()}`, type: 'album',
      rarityId: await anyRarityId(),
      artworkUrl: "https://example.com/album-art.jpg",
      animatedArtworkUrl: "https://example.com/album-animated.mp4",
    });
    const singleRow = await DiscotecaDB.createEntry({
      name: `Test Media AlbumArt Single ${Date.now()}`, artistId, appleMusicId: `test-media-albumart-single-${Date.now()}`, type: 'single',
      rarityId: await anyRarityId(),
      artworkUrl: "https://example.com/track-art.jpg",
      albumId: albumRow!.id,
    });
    fx.onCleanup(async () => {
      await db.delete(discotecaEntries).where(eq(discotecaEntries.id, singleRow!.id));
      await db.delete(discotecaEntries).where(eq(discotecaEntries.id, albumRow!.id));
    });
    const entry = (await DiscotecaDB.getEntryWithDetails(singleRow!.id))!;

    const media = await resolveEntryMedia('discord', entry);
    expect(media.kind).toBe('photo');
    expect((media as any).photoUrl).toBe("https://example.com/album-art.jpg");
  });

  test("resolveEntryMedia: album - static artwork on Discord, animated on Telegram", async () => {
    const artistId = (await fx.discotecaArtist()).id;
    const albumRow = await DiscotecaDB.createEntry({
      name: `Test Media Album ${Date.now()}`, artistId, appleMusicId: `test-media-album-${Date.now()}`, type: 'album',
      rarityId: await anyRarityId(),
      artworkUrl: "https://example.com/album-art.jpg",
      animatedArtworkUrl: "https://example.com/album-animated.mp4",
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, albumRow!.id)); });
    const entry = (await DiscotecaDB.getEntryWithDetails(albumRow!.id))!;

    const discordMedia = await resolveEntryMedia('discord', entry);
    expect((discordMedia as any).photoUrl).toBe("https://example.com/album-animated.mp4");
    const telegramMedia = await resolveEntryMedia('telegram', entry);
    expect((telegramMedia as any).photoUrl).toBe("https://example.com/album-animated.mp4");
  });
});
