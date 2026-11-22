import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, mockAppleMusic, anyRarityId, deleteById, awaitRecv } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { CardsDB } from "@girae/database/cards";
import { DiscotecaDB } from "@girae/database/discoteca";
import { db } from "@girae/database/index";
import { discotecaEntries, discotecaEntrySubcategories, discotecaGenreAliases, discotecaArtists, discotecaAlbumTracks } from "@girae/database/schemas/discoteca";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";

mockTelegram();
const appleMusicState = mockAppleMusic();

import AddAlbumCommand from "../../commands/discoteca/addalbum";

const testAlbumAppleMusicId = `test-album-${Date.now()}`;

describe("/addalbum", () => {
  const fx = new TestFixtures();
  let staffPlatformId: string;
  let staffId: number;
  let popSubcategoryId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    staffPlatformId = `test-addalbum-staff-${Date.now()}`;
    staffId = (await fx.user({ displayName: "Test Addalbum Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId)); });

    const popGenreId = (await fx.discotecaGenre({ name: `Test Pop ${Date.now()}` })).id;
    popSubcategoryId = (await fx.discotecaSubcategory({ genreId: popGenreId, isAlbum: true, name: `Test Álbuns de Pop ${Date.now()}`, emoji: '💽' })).id;
    const alias = await DiscotecaDB.upsertGenreAlias('pop', popGenreId);
    fx.onCleanup(async () => { await db.delete(discotecaGenreAliases).where(eq(discotecaGenreAliases.id, alias!.id)); });

    appleMusicState.shouldThrow = false;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: testAlbumAppleMusicId, attributes: { name: "Test Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: testAlbumAppleMusicId,
        attributes: { name: "Test Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: ["Pop", "Music"] },
        relationships: {
          tracks: { data: [{ id: "test-track-1", type: "songs", attributes: { name: "Track One", trackNumber: 1, durationInMillis: 180000, isrc: "US1234567890" } }] },
          artists: { data: [{ id: "test-artist-apple-id", attributes: { name: "Test Artist" } }] },
        },
      }],
    };
  });

  afterAll(() => fx.cleanup());

  test("searches, picks the only candidate, saves with the fallback rarity", async () => {
    const workflowID = `test-addalbum-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entryRows = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, testAlbumAppleMusicId));
    expect(entryRows.length).toBe(1);
    const entry = entryRows[0]!;
    expect(entry.name).toBe("Test Album");
    expect(entry.type).toBe('album');
    // real (unmocked) getOrProcessAnimatedCover call - fake appleMusicId 404s, caught, returns null
    expect(entry.animatedArtworkUrl).toBeNull();
    fx.onCleanup(async () => {
      await db.delete(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry.id));
      await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry.id));
    });

    const genreRows = await db.select().from(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry.id));
    expect(genreRows.map(r => r.subcategoryId)).toEqual([popSubcategoryId]);

    const artist = await DiscotecaDB.getArtist(entry.artistId);
    expect(artist?.name).toBe("Test Artist");

    // getRarities() has no ORDER BY - just confirm a real catalog rarity, not a specific position
    const rarities = await CardsDB.getRarities();
    expect(rarities.map(r => r.id)).toContain(entry.rarityId);

    const trackRows = await db.select().from(discotecaAlbumTracks).where(eq(discotecaAlbumTracks.entryId, entry.id));
    expect(trackRows.map(t => t.name)).toEqual(["Track One"]);
    expect(trackRows[0]?.trackAppleMusicId).toBe("test-track-1");
  }, 15000);

  test("backfills a pre-existing unlinked single whose name matches a track on the new album", async () => {
    const backfillArtistId = (await DiscotecaDB.getOrCreateArtist("test-artist-apple-id-backfill", "Test Backfill Artist"))!.id;
    fx.onCleanup(async () => { await deleteById('discoteca_artists', backfillArtistId); });
    const preexistingSingle = await DiscotecaDB.createEntry({
      name: "Backfill Track", artistId: backfillArtistId, appleMusicId: `test-backfill-single-${Date.now()}`, type: 'single',
      rarityId: await anyRarityId(),
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, preexistingSingle!.id)); });

    const backfillAlbumAppleMusicId = `test-backfill-album-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: backfillAlbumAppleMusicId, attributes: { name: "Backfill Album", artistName: "Test Backfill Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: backfillAlbumAppleMusicId,
        attributes: { name: "Backfill Album", artistName: "Test Backfill Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [] },
        relationships: {
          tracks: { data: [{ id: "test-backfill-track-on-album", type: "songs", attributes: { name: "Backfill Track" } }] },
          artists: { data: [{ id: "test-artist-apple-id-backfill", attributes: { name: "Test Backfill Artist" } }] },
        },
      }],
    };

    const workflowID = `test-addalbum-backfill-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const albumEntry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, backfillAlbumAppleMusicId)).then(r => r[0]);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, albumEntry!.id)); });

    const updatedSingle = await db.select().from(discotecaEntries).where(eq(discotecaEntries.id, preexistingSingle!.id)).then(r => r[0]);
    expect(updatedSingle?.albumId).toBe(albumEntry!.id);
  }, 15000);

  test("warns on the confirm screen when the same album name already exists for this artist", async () => {
    const dupAlbumAppleMusicId = `test-album-dup-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: dupAlbumAppleMusicId, attributes: { name: "Test Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: dupAlbumAppleMusicId,
        attributes: { name: "Test Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [] },
        relationships: { tracks: { data: [] }, artists: { data: [{ id: "test-artist-apple-id", attributes: { name: "Test Artist" } }] } },
      }],
    };
    // "Test Artist" / "Test Album" was already saved by the first test in this file - same artist, same name

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
      const workflowID = `test-addalbum-dup-${Bun.randomUUIDv7()}`;
      const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
      const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

      await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
      await DBOS.send(workflowID, { value: { action: 'cancel' } }, 'discoteca:confirm');
      await handle.getResult();
    } finally {
      // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
      fetch = originalFetch;
    }

    expect(captions.length).toBeGreaterThan(0);
    expect(captions[0]).toContain('Já existe um álbum');
  }, 15000);

  test("editing the name before saving overrides the Apple Music name", async () => {
    const otherAlbumAppleMusicId = `test-album-renamed-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: otherAlbumAppleMusicId, attributes: { name: "Original Name", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: otherAlbumAppleMusicId,
        attributes: { name: "Original Name", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [] },
        relationships: { tracks: { data: [] }, artists: { data: [{ id: "test-artist-apple-id", attributes: { name: "Test Artist" } }] } },
      }],
    };

    const workflowID = `test-addalbum-rename-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    await DBOS.send(workflowID, { value: { action: 'editName' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: "Renamed Album" }, 'discoteca:name');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, otherAlbumAppleMusicId)).then(r => r[0]);
    expect(entry?.name).toBe("Renamed Album");
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });
  }, 15000);

  test("re-checking genres picks up an alias mapped after the search happened", async () => {
    const otherAlbumAppleMusicId = `test-album-recheck-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: otherAlbumAppleMusicId, attributes: { name: "Recheck Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: otherAlbumAppleMusicId,
        attributes: { name: "Recheck Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: ["Hyperpop"] },
        relationships: { tracks: { data: [] }, artists: { data: [{ id: "test-artist-apple-id", attributes: { name: "Test Artist" } }] } },
      }],
    };

    const workflowID = `test-addalbum-recheck-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    await awaitRecv(workflowID, 2); // pick consumed, parked on the confirm prompt

    // "Hyperpop" is unmapped at this point - map it mid-flow, like staff running /genrealias in another message
    const hyperpopGenreId = (await fx.discotecaGenre({ name: `Test Hyperpop ${Date.now()}` })).id;
    const hyperpopSubcategoryId = (await fx.discotecaSubcategory({ genreId: hyperpopGenreId, isAlbum: true, name: `Test Álbuns de Hyperpop ${Date.now()}`, emoji: '💽' })).id;
    const alias = await DiscotecaDB.upsertGenreAlias('hyperpop', hyperpopGenreId);
    fx.onCleanup(async () => { await db.delete(discotecaGenreAliases).where(eq(discotecaGenreAliases.id, alias!.id)); });

    await DBOS.send(workflowID, { value: { action: 'recheckGenres' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, otherAlbumAppleMusicId)).then(r => r[0]);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    const genreRows = await db.select().from(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
    expect(genreRows.map(r => r.subcategoryId)).toEqual([hyperpopSubcategoryId]);
  }, 15000);

  test("K-Pop is exclusive: when mapped alongside other genres, only K-Pop is kept", async () => {
    const kpopAlbumSubcategory = await DiscotecaDB.getSubcategoryByName('Álbuns de K-Pop');
    if (!kpopAlbumSubcategory) throw new Error("expected the real seeded 'Álbuns de K-Pop' subcategory to exist");

    const otherAlbumAppleMusicId = `test-album-kpop-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: otherAlbumAppleMusicId, attributes: { name: "KPop Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: otherAlbumAppleMusicId,
        // "K-Pop" resolves via the real seeded genre name; "Pop" resolves via this file's own overridden 'pop' alias
        attributes: { name: "KPop Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: ["K-Pop", "Pop"] },
        relationships: { tracks: { data: [] }, artists: { data: [{ id: "test-artist-apple-id", attributes: { name: "Test Artist" } }] } },
      }],
    };

    const workflowID = `test-addalbum-kpop-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, otherAlbumAppleMusicId)).then(r => r[0]);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    const genreRows = await db.select().from(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
    expect(genreRows.map(r => r.subcategoryId)).toEqual([kpopAlbumSubcategory.id]);
  }, 15000);

  test("Punk/Rock is exclusive: when mapped alongside other genres, only Punk/Rock is kept", async () => {
    const rockAlbumSubcategory = await DiscotecaDB.getSubcategoryByName('Álbuns de Punk/Rock');
    if (!rockAlbumSubcategory) throw new Error("expected the real seeded 'Álbuns de Punk/Rock' subcategory to exist");

    const otherAlbumAppleMusicId = `test-album-rock-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: otherAlbumAppleMusicId, attributes: { name: "Rock Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: otherAlbumAppleMusicId,
        // "Punk/Rock" resolves via the real seeded genre name; "Pop" resolves via this file's own overridden 'pop' alias
        attributes: { name: "Rock Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: ["Punk/Rock", "Pop"] },
        relationships: { tracks: { data: [] }, artists: { data: [{ id: "test-artist-apple-id", attributes: { name: "Test Artist" } }] } },
      }],
    };

    const workflowID = `test-addalbum-rock-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, otherAlbumAppleMusicId)).then(r => r[0]);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    const genreRows = await db.select().from(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
    expect(genreRows.map(r => r.subcategoryId)).toEqual([rockAlbumSubcategory.id]);
  }, 15000);

  test("adding/removing genres accepts a comma-separated list, toggling each independently", async () => {
    const otherAlbumAppleMusicId = `test-album-multigenre-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: otherAlbumAppleMusicId, attributes: { name: "MultiGenre Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: otherAlbumAppleMusicId,
        attributes: { name: "MultiGenre Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [] },
        relationships: { tracks: { data: [] }, artists: { data: [{ id: "test-artist-apple-id", attributes: { name: "Test Artist" } }] } },
      }],
    };

    const genreAName = `Test Multi A ${Date.now()}`;
    const genreAId = (await fx.discotecaGenre({ name: genreAName })).id;
    const subAId = (await fx.discotecaSubcategory({ genreId: genreAId, isAlbum: true, name: `Test Álbuns Multi A ${Date.now()}` })).id;
    const genreBName = `Test Multi B ${Date.now()}`;
    const genreBId = (await fx.discotecaGenre({ name: genreBName })).id;
    const subBId = (await fx.discotecaSubcategory({ genreId: genreBId, isAlbum: true, name: `Test Álbuns Multi B ${Date.now()}` })).id;

    const workflowID = `test-addalbum-multigenre-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], workflowID, platform: 'telegram' });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');

    // both absent - a single comma-separated message adds both
    await DBOS.send(workflowID, { value: { action: 'addGenre' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: `${genreAName}, ${genreBName}` }, 'discoteca:addGenre');

    // sending B again alone removes only B, A stays
    await DBOS.send(workflowID, { value: { action: 'addGenre' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: genreBName }, 'discoteca:addGenre');

    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, otherAlbumAppleMusicId)).then(r => r[0]);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    const genreRows = await db.select().from(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
    expect(genreRows.map(r => r.subcategoryId)).toEqual([subAId]);
  }, 15000);

  test("manually adding an existing genre by name attaches it, unknown names get a not-found reply", async () => {
    const otherAlbumAppleMusicId = `test-album-addgenre-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: otherAlbumAppleMusicId, attributes: { name: "AddGenre Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: otherAlbumAppleMusicId,
        attributes: { name: "AddGenre Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [] },
        relationships: { tracks: { data: [] }, artists: { data: [{ id: "test-artist-apple-id", attributes: { name: "Test Artist" } }] } },
      }],
    };

    const manualGenreName = `Test Manual Genre ${Date.now()}`;
    const manualGenreId = (await fx.discotecaGenre({ name: manualGenreName })).id;
    const manualSubcategoryId = (await fx.discotecaSubcategory({ genreId: manualGenreId, isAlbum: true })).id;

    const workflowID = `test-addalbum-addgenre-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');

    // an unknown genre name should be rejected without touching the loop's state
    await DBOS.send(workflowID, { value: { action: 'addGenre' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: "Totally Nonexistent Genre" }, 'discoteca:addGenre');

    await DBOS.send(workflowID, { value: { action: 'addGenre' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: manualGenreName }, 'discoteca:addGenre');

    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, otherAlbumAppleMusicId)).then(r => r[0]);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    const genreRows = await db.select().from(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
    expect(genreRows.map(r => r.subcategoryId)).toEqual([manualSubcategoryId]);
  }, 15000);

  test("sending the same genre name a second time removes it instead of duplicating", async () => {
    const otherAlbumAppleMusicId = `test-album-togglegenre-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: otherAlbumAppleMusicId, attributes: { name: "ToggleGenre Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: otherAlbumAppleMusicId,
        attributes: { name: "ToggleGenre Album", artistName: "Test Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [] },
        relationships: { tracks: { data: [] }, artists: { data: [{ id: "test-artist-apple-id", attributes: { name: "Test Artist" } }] } },
      }],
    };

    const toggleGenreName = `Test Toggle Genre ${Date.now()}`;
    const toggleGenreId = (await fx.discotecaGenre({ name: toggleGenreName })).id;
    const toggleSubcategoryId = (await fx.discotecaSubcategory({ genreId: toggleGenreId, isAlbum: true })).id;

    const workflowID = `test-addalbum-togglegenre-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');

    // first send: adds it
    await DBOS.send(workflowID, { value: { action: 'addGenre' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: toggleGenreName }, 'discoteca:addGenre');

    // second send of the same name: removes it
    await DBOS.send(workflowID, { value: { action: 'addGenre' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: toggleGenreName }, 'discoteca:addGenre');

    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, otherAlbumAppleMusicId)).then(r => r[0]);
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    const genreRows = await db.select().from(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
    expect(genreRows.map(r => r.subcategoryId)).not.toContain(toggleSubcategoryId);
  }, 15000);

  test("manually linking an artist card via the button updates the artist row", async () => {
    const otherAlbumAppleMusicId = `test-album-linkcard-${Date.now()}`;
    const otherArtistAppleMusicId = `test-artist-linkcard-${Date.now()}`;
    appleMusicState.searchResult = {
      results: { albums: { data: [{ id: otherAlbumAppleMusicId, attributes: { name: "LinkCard Album", artistName: "Test LinkCard Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01" } }] } },
    };
    appleMusicState.albumResult = {
      data: [{
        id: otherAlbumAppleMusicId,
        attributes: { name: "LinkCard Album", artistName: "Test LinkCard Artist", artwork: { url: "https://example.com/{w}x{h}bb.{f}" }, releaseDate: "2024-01-01", genreNames: [] },
        relationships: {
          tracks: { data: [] },
          artists: { data: [{ id: otherArtistAppleMusicId, attributes: { name: "Test LinkCard Artist" } }] },
        },
      }],
    };

    const musicCategoryId = (await CardsDB.getCategoryByName('Música') ?? await CardsDB.createCategory('Música', '🎸'))!.id;
    const musicSubcategoryId = (await fx.subcategory({ categoryId: musicCategoryId, name: `Test LinkCard Sub ${Date.now()}` })).id;
    const targetCardId = (await fx.card({ name: `Test LinkCard Target Card ${Date.now()}`, subcategoryId: musicSubcategoryId })).id;

    const workflowID = `test-addalbum-linkcard-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'addalbum', authorId: staffPlatformId, args: ['test query'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(AddAlbumCommand, { workflowID }).execute(runCtx, { query: 'test query' });

    await DBOS.send(workflowID, { value: { index: 0 } }, 'discoteca:pick');
    await DBOS.send(workflowID, { value: { action: 'linkArtistCard' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: String(targetCardId) }, 'discoteca:artistCard');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const entry = await db.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, otherAlbumAppleMusicId)).then(r => r[0]);
    // LIFO cleanup: register the artist delete first so it runs *after* the entry delete below (entries.artistId FK)
    fx.onCleanup(async () => {
      const artist = await db.select({ id: discotecaArtists.id }).from(discotecaArtists).where(eq(discotecaArtists.appleMusicArtistId, otherArtistAppleMusicId)).then(r => r[0]);
      if (artist) await deleteById('discoteca_artists', artist.id);
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)); });

    const artist = await DiscotecaDB.getArtist(entry!.artistId);
    expect(artist?.cardId).toBe(targetCardId);
  }, 15000);

});
