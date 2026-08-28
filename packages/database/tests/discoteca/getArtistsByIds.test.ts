import { test, expect, describe, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { discotecaArtists } from "../../schemas/discoteca";
import { eq } from "drizzle-orm";
import { DiscotecaDB } from "../../discoteca";

describe("DiscotecaDB.getArtistsByIds", () => {
  const fx = new TestFixtures();

  afterAll(() => fx.cleanup());

  test("batch-resolves artists for the given ids, skipping unknown ones", async () => {
    const a = await DiscotecaDB.getOrCreateArtist(`test-artist-batch-a-${Date.now()}`, `Test Batch Artist A ${Date.now()}`);
    fx.onCleanup(async () => { await db.delete(discotecaArtists).where(eq(discotecaArtists.id, a!.id)); });
    const b = await DiscotecaDB.getOrCreateArtist(`test-artist-batch-b-${Date.now()}`, `Test Batch Artist B ${Date.now()}`);
    fx.onCleanup(async () => { await db.delete(discotecaArtists).where(eq(discotecaArtists.id, b!.id)); });

    const rows = await DiscotecaDB.getArtistsByIds([a!.id, b!.id, 999999999]);
    const byId = new Map(rows.map(r => [r.id, r]));

    expect(byId.get(a!.id)?.name).toBe(a!.name);
    expect(byId.get(b!.id)?.name).toBe(b!.name);
    expect(byId.has(999999999)).toBe(false);
  });

  test("returns an empty array for an empty id list", async () => {
    const rows = await DiscotecaDB.getArtistsByIds([]);
    expect(rows).toEqual([]);
  });
});
