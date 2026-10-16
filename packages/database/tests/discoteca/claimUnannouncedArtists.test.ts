import { test, expect, describe, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { DiscotecaDB } from "../../discoteca";
import { db } from "../../index";
import { discotecaEntries } from "../../schemas/discoteca";
import { eq } from "drizzle-orm";

describe("DiscotecaDB.claimUnannouncedArtists", () => {
  const fx = new TestFixtures();

  afterAll(() => fx.cleanup());

  // onlyIds scopes every claim below to just this test's own fixtures - the underlying UPDATE is otherwise table-wide.

  test("claims an artist older than cutoff along with its entries, but only once", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Claim Artist" })).id;
    const entryId = (await fx.discotecaEntry({ name: "Test Claim Entry", artistId })).id;
    const cutoff = new Date();

    const firstRun = await DiscotecaDB.claimUnannouncedArtists(cutoff, [artistId]);
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0]?.id).toBe(artistId);
    expect(firstRun[0]?.entries.map(e => e.id)).toEqual([entryId]);
    expect(firstRun[0]?.entries[0]?.rarityEmoji).toBeTruthy();

    const secondRun = await DiscotecaDB.claimUnannouncedArtists(cutoff, [artistId]);
    expect(secondRun).toHaveLength(0);
  });

  test("an artist's entries claimed this way are excluded from claimUnannouncedEntries", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Claim Artist 2" })).id;
    const entryId = (await fx.discotecaEntry({ name: "Test Claim Entry 2", artistId })).id;
    const cutoff = new Date();

    await DiscotecaDB.claimUnannouncedArtists(cutoff, [artistId]);
    const entryRows = await DiscotecaDB.claimUnannouncedEntries(cutoff, [entryId]);
    expect(entryRows).toHaveLength(0);
  });

  test("includes an entry moved in (via mergeArtists) from an artist already announced before", async () => {
    const oldArtistId = (await fx.discotecaArtist({ name: "Test Claim Artist Old" })).id;
    const entryId = (await fx.discotecaEntry({ name: "Test Claim Moved Entry", artistId: oldArtistId })).id;
    const cutoff = new Date();
    // announce it once under the old artist so its discoteca_entries.announcedAt is already set
    await DiscotecaDB.claimUnannouncedArtists(cutoff, [oldArtistId]);

    const newArtistId = (await fx.discotecaArtist({ name: "Test Claim Artist New" })).id;
    // registered after newArtistId's cleanup so LIFO teardown deletes the reassigned entry first, or its FK blocks newArtistId's delete.
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entryId)); });
    await DiscotecaDB.mergeArtists(oldArtistId, newArtistId); // deletes oldArtistId, moves the entry onto newArtistId

    const claimed = await DiscotecaDB.claimUnannouncedArtists(new Date(), [newArtistId]);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.entries.map(e => e.id)).toEqual([entryId]);
  });

  test("an artist younger than cutoff is not claimed", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Claim Artist Fresh" })).id;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const claimed = await DiscotecaDB.claimUnannouncedArtists(oneHourAgo, [artistId]);
    expect(claimed).toHaveLength(0);
  });
});
