import { test, expect, describe, afterAll } from "bun:test";
import { TestFixtures, anyRarityId } from "@girae/tests";
import { DiscotecaDB } from "../../discoteca";
import { db } from "../../index";
import { discotecaEntries } from "../../schemas/discoteca";
import { inArray } from "drizzle-orm";

describe("DiscotecaDB.getEntriesByType", () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  test("only returns entries of the requested type, with pagination and owned counts", async () => {
    const artistId = (await fx.discotecaArtist()).id;
    const rarityId = await anyRarityId();
    const albumId = (await DiscotecaDB.createEntry({
      name: `Test GetByType Album ${Date.now()}`, artistId, appleMusicId: `test-getbytype-album-${Date.now()}`, type: 'album', rarityId,
    }))!.id;
    const singleId = (await DiscotecaDB.createEntry({
      name: `Test GetByType Single ${Date.now()}`, artistId, appleMusicId: `test-getbytype-single-${Date.now()}`, type: 'single', rarityId,
    }))!.id;
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(inArray(discotecaEntries.id, [albumId, singleId])); });

    const userId = (await fx.user({ displayName: "Test GetByType User", platform: 'telegram', platformId: `test-getbytype-user-${Date.now()}` })).id;
    await DiscotecaDB.addUserDiscoteca(userId, albumId);

    const { rows } = await DiscotecaDB.getEntriesByType('album', userId, 100_000, 0);
    const found = rows.find(r => r.id === albumId);
    expect(found).toBeDefined();
    expect(found!.ownedCount).toBe(1);
    expect(rows.some(r => r.id === singleId)).toBe(false);
  });

  test("paginates and reports the correct total", async () => {
    const { total } = await DiscotecaDB.getEntriesByType('single', 0, 1, 0);
    const allRows = await DiscotecaDB.getEntriesByType('single', 0, 100000, 0);
    expect(total).toBe(allRows.rows.length);
  });
});
