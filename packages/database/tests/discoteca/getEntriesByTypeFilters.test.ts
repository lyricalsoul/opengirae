import { test, expect, describe, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { DiscotecaDB } from "../../discoteca";
import { CardsDB } from "../../cards";

describe("DiscotecaDB.getEntriesByType filters", () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  test("owned filter narrows to entries the user owns; rarity filter narrows by rarity name", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Filter Artist" })).id;
    const rarities = await CardsDB.getRarities();
    const rarityId = rarities[0]!.id;
    const otherRarityId = rarities.find(r => r.id !== rarityId)?.id ?? rarityId;

    const owned = await fx.discotecaEntry({ name: `Test Filter Owned ${Date.now()}`, artistId, type: 'single', rarityId });
    const unowned = await fx.discotecaEntry({ name: `Test Filter Unowned ${Date.now()}`, artistId, type: 'single', rarityId: otherRarityId });

    const user = await fx.user({ displayName: "Test Filter User" });
    await DiscotecaDB.addUserDiscoteca(user.id, owned.id);

    const ownedOnly = await DiscotecaDB.getEntriesByType('single', user.id, 100_000, 0, { ownedFilter: 'owned' });
    expect(ownedOnly.rows.map(r => r.id)).toContain(owned.id);
    expect(ownedOnly.rows.map(r => r.id)).not.toContain(unowned.id);

    const unownedOnly = await DiscotecaDB.getEntriesByType('single', user.id, 100_000, 0, { ownedFilter: 'missing' });
    expect(unownedOnly.rows.map(r => r.id)).toContain(unowned.id);
    expect(unownedOnly.rows.map(r => r.id)).not.toContain(owned.id);

    const byRarity = await DiscotecaDB.getEntriesByType('single', user.id, 100_000, 0, { rarityNames: [rarities[0]!.name] });
    expect(byRarity.rows.map(r => r.id)).toContain(owned.id);
  });
});
