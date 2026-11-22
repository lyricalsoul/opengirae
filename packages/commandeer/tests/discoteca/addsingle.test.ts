import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, mockAppleMusic } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { CardsDB } from "@girae/database/cards";
import { DiscotecaDB } from "@girae/database/discoteca";
import { db } from "@girae/database/index";
import { discotecaEntries, discotecaPreviewCache } from "@girae/database/schemas/discoteca";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";

const { sentMessages } = mockTelegram();
const appleMusicState = mockAppleMusic();

import AddSingleCommand from "../../commands/discoteca/addsingle";

const testSongAppleMusicId = `test-song-${Date.now()}`;
const testParentAlbumAppleMusicId = `test-parent-album-${Date.now()}`;
const cachedPreviewUrl = "https://cdn.example.com/tagged-preview.m4a";

describe("/addsingle", () => {
  const fx = new TestFixtures();
  let staffPlatformId: string;
  let staffId: number;
  let rarityId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    staffPlatformId = `test-addsingle-staff-${Date.now()}`;
    staffId = (await fx.user({ displayName: "Test Addsingle Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId)); });
    rarityId = (await CardsDB.getRarities())[0]!.id;

    appleMusicState.shouldThrow = false;
    appleMusicState.searchResult = {
      results: { songs: { data: [{ id: testSongAppleMusicId, attributes: { name: "Test Song", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.songResult = {
      data: [{
        id: testSongAppleMusicId,
        attributes: {
          name: "Test Song", artistName: "Test Artist", albumName: "Test Parent Album",
          artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01",
          genreNames: ["Pop"], previews: [{ url: "https://example.com/preview.m4a" }],
        },
        relationships: {
          albums: { data: [{ id: testParentAlbumAppleMusicId, type: "albums" }] },
          artists: { data: [{ id: "test-artist-apple-id-single", attributes: { name: "Test Artist" } }] },
        },
      }],
    };

    // a cache hit short-circuits before fetch/ffmpeg - avoids mocking preview.ts itself
    await DiscotecaDB.setPreviewCacheEntry(testSongAppleMusicId, cachedPreviewUrl);
    fx.onCleanup(async () => { await db.delete(discotecaPreviewCache).where(eq(discotecaPreviewCache.appleMusicTrackId, testSongAppleMusicId)); });
  });

  afterAll(() => fx.cleanup());

  test("links to an existing parent album entry via albumId, saves the cached preview URL", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Artist" })).id;
    const parentAlbum = await DiscotecaDB.createEntry({
      name: "Test Parent Album", artistId, appleMusicId: testParentAlbumAppleMusicId, type: 'album', rarityId,
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, parentAlbum!.id)); });

    const workflowID = `test-addsingle-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addsingle', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });

    // the saved-entry message now sends the preview audio too, so the answerer fetches its bytes
    const originalFetch = fetch;
    // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
    fetch = (async () => new Response(new Uint8Array([0]))) as unknown as typeof fetch;
    const handle = await DBOS.startWorkflow(AddSingleCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();
    // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
    fetch = originalFetch;

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, testSongAppleMusicId)).then(r => r[0]);
    expect(entry?.type).toBe('single');
    expect(entry?.albumId).toBe(parentAlbum!.id);
    expect(entry?.albumAppleMusicId).toBe(testParentAlbumAppleMusicId);
    expect(entry?.previewUrl).toBe(cachedPreviewUrl);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    const last = sentMessages[sentMessages.length - 1]!;
    expect(last.method).toBe('sendAudio');
    expect(last.performer).toBe("Test Artist");
    expect(last.title).toBe("Test Song");
  }, 15000);

  test("falls back to a local track-name match when the relationship id doesn't resolve to a cataloged album", async () => {
    // Apple Music gives a pre-released single its own standalone "album" id, different from the
    // LP's, and mints yet another id for the same track once it's actually on the album - the
    // only signal left in common is the track name, matched against the locally cached tracklist
    const artistId = (await fx.discotecaArtist({ name: "Test Fallback Artist", appleMusicArtistId: "test-artist-apple-id-fallback" })).id;
    const parentAlbumAppleMusicId = `test-fallback-album-${Date.now()}`;
    const parentAlbum = await DiscotecaDB.createEntry({
      name: "Test Fallback Album", artistId, appleMusicId: parentAlbumAppleMusicId, type: 'album', rarityId,
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, parentAlbum!.id)); });
    await DiscotecaDB.cacheAlbumTracks(parentAlbum!.id, [{ trackAppleMusicId: "test-track-on-album", name: "Test Fallback Song" }]);

    const fallbackSongAppleMusicId = `test-song-fallback-${Date.now()}`;
    const unrelatedAlbumAppleMusicId = `test-song-fallback-single-release-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { songs: { data: [{ id: fallbackSongAppleMusicId, attributes: { name: "Test Fallback Song", artistName: "Test Fallback Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.songResult = {
      data: [{
        id: fallbackSongAppleMusicId,
        attributes: {
          name: "Test Fallback Song", artistName: "Test Fallback Artist", albumName: "Test Fallback Song - Single",
          artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [],
        },
        relationships: {
          albums: { data: [{ id: unrelatedAlbumAppleMusicId, type: "albums" }] },
          artists: { data: [{ id: "test-artist-apple-id-fallback", attributes: { name: "Test Fallback Artist" } }] },
        },
      }],
    };

    const workflowID = `test-addsingle-fallback-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addsingle', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddSingleCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, fallbackSongAppleMusicId)).then(r => r[0]);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    expect(entry?.albumId).toBe(parentAlbum!.id);
    expect(entry?.albumAppleMusicId).toBe(unrelatedAlbumAppleMusicId);
  }, 15000);

  test("warns on the confirm screen when the same single name already exists for this artist", async () => {
    const dupSongAppleMusicId = `test-song-dup-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { songs: { data: [{ id: dupSongAppleMusicId, attributes: { name: "Test Song", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.songResult = {
      data: [{
        id: dupSongAppleMusicId,
        attributes: { name: "Test Song", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [] },
        relationships: { albums: { data: [] }, artists: { data: [{ id: "test-artist-apple-id-single", attributes: { name: "Test Artist" } }] } },
      }],
    };
    // same artist as the first test's saved song (matched by Apple Music artist id), same name

    const captions: string[] = [];
    const originalFetch = fetch;
    // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
    fetch = (async (url: string, init?: any) => {
      if (String(url).includes('/editMessageMedia')) {
        const body = JSON.parse(init.body);
        captions.push(body.media.caption ?? '');
        return new Response(JSON.stringify({ ok: true, result: { message_id: 999 } }));
      }
      return originalFetch(url, init);
    }) as unknown as typeof fetch;

    try {
      const workflowID = `test-addsingle-dup-${Bun.randomUUIDv7()}`;
      const runCtx = fakeCtx({ name: 'addsingle', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
      const handle = await DBOS.startWorkflow(AddSingleCommand, { workflowID }).execute(runCtx, { query: 'test query' });

      await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
      await DBOS.send(workflowID, { value: { action: 'cancel' } }, 'discoteca:confirm');
      await handle.getResult();
    } finally {
      // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
      fetch = originalFetch;
    }

    expect(captions.length).toBeGreaterThan(0);
    expect(captions[0]).toContain('Já existe um single');
  }, 15000);

  test("staff can override the suggested album via the 🔄 Trocar álbum button", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Override Artist", appleMusicArtistId: "test-artist-apple-id-override" })).id;
    const wrongAlbum = await DiscotecaDB.createEntry({
      name: "Test Wrong Album", artistId, appleMusicId: `test-override-wrong-${Date.now()}`, type: 'album', rarityId,
    });
    const rightAlbum = await DiscotecaDB.createEntry({
      name: "Test Right Album", artistId, appleMusicId: `test-override-right-${Date.now()}`, type: 'album', rarityId,
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, wrongAlbum!.id)); });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, rightAlbum!.id)); });
    await DiscotecaDB.cacheAlbumTracks(wrongAlbum!.id, [{ trackAppleMusicId: "t-wrong", name: "Test Override Song" }]);

    const overrideSongAppleMusicId = `test-song-override-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { songs: { data: [{ id: overrideSongAppleMusicId, attributes: { name: "Test Override Song", artistName: "Test Override Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.songResult = {
      data: [{
        id: overrideSongAppleMusicId,
        attributes: { name: "Test Override Song", artistName: "Test Override Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [] },
        relationships: { albums: { data: [] }, artists: { data: [{ id: "test-artist-apple-id-override", attributes: { name: "Test Override Artist" } }] } },
      }],
    };

    const workflowID = `test-addsingle-override-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addsingle', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddSingleCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    // suggested album is "Test Wrong Album" via the track-name match - override it
    await DBOS.send(workflowID, { value: { action: 'changeAlbum' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: String(rightAlbum!.id) }, 'discoteca:album');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, overrideSongAppleMusicId)).then(r => r[0]);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    expect(entry?.albumId).toBe(rightAlbum!.id);
  }, 15000);
});
