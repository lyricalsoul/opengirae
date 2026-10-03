import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { DiscotecaDB } from "../../discoteca";

describe("DiscotecaDB.claimUnannouncedEntries", () => {
  const fx = new TestFixtures();
  let artistId: number;

  beforeAll(async () => {
    artistId = (await fx.discotecaArtist({ name: `Test Claim Entries Artist ${Date.now()}` })).id;
    // mark the artist as already-announced first, so entries added below hit claimUnannouncedEntries's own path, not the artist-claim auto-claim.
    await DiscotecaDB.claimUnannouncedArtists(new Date(), [artistId]);
  });

  afterAll(() => fx.cleanup());

  test("claims a new entry added to an already-announced artist, grouped with rarity/artist details", async () => {
    const entryId = (await fx.discotecaEntry({ name: "Test Claim Entry New", artistId })).id;
    const cutoff = new Date();

    const firstRun = await DiscotecaDB.claimUnannouncedEntries(cutoff, [entryId]);
    expect(firstRun).toHaveLength(1);
    const row = firstRun[0]!;
    expect(row.id).toBe(entryId);
    expect(row.artistId).toBe(artistId);
    expect(row.rarityEmoji).toBeTruthy();
    expect(row.artistName).toBeTruthy();

    const secondRun = await DiscotecaDB.claimUnannouncedEntries(cutoff, [entryId]);
    expect(secondRun).toHaveLength(0);
  });

  test("orders newly-claimed entries rarest-first, regardless of creation order", async () => {
    const common = await fx.rarity({ name: `Test Common ${Date.now()}`, weight: 1000 });
    const rare = await fx.rarity({ name: `Test Rare ${Date.now()}`, weight: 100 });
    const legendary = await fx.rarity({ name: `Test Legendary ${Date.now()}`, weight: 10 });

    const commonId = (await fx.discotecaEntry({ name: "Test Claim Ordered Common", rarityId: common.id, artistId })).id;
    const rareId = (await fx.discotecaEntry({ name: "Test Claim Ordered Rare", rarityId: rare.id, artistId })).id;
    const legendaryId = (await fx.discotecaEntry({ name: "Test Claim Ordered Legendary", rarityId: legendary.id, artistId })).id;
    const cutoff = new Date();

    const claimed = await DiscotecaDB.claimUnannouncedEntries(cutoff, [commonId, rareId, legendaryId]);
    expect(claimed.map(c => c.id)).toEqual([legendaryId, rareId, commonId]);
  });

  test("an entry younger than cutoff is not claimed", async () => {
    const entryId = (await fx.discotecaEntry({ name: "Test Claim Entry Fresh", artistId })).id;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const claimed = await DiscotecaDB.claimUnannouncedEntries(oneHourAgo, [entryId]);
    expect(claimed).toHaveLength(0);
  });
});
