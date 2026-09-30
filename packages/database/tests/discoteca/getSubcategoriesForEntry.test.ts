import { test, expect, describe } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { DiscotecaDB } from "../../discoteca";

describe("DiscotecaDB.getSubcategoriesForEntry", () => {
  const fx = new TestFixtures();

  test("returns the subcategory id/name - the id setEntryGenres actually expects, unlike getGenresForEntry's genre id", async () => {
    const genreId = (await fx.discotecaGenre({ name: `Alternativo ${Date.now()}` })).id;
    const subcategoryId = (await fx.discotecaSubcategory({ genreId, isAlbum: true, name: `Álbuns de Alternativo ${Date.now()}` })).id;
    const entryId = (await fx.discotecaEntry({ type: 'album' })).id;
    await DiscotecaDB.setEntryGenres(entryId, [subcategoryId]);

    const rows = await DiscotecaDB.getSubcategoriesForEntry(entryId);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(subcategoryId);
    expect(rows[0]!.id).not.toBe(genreId);
    expect(rows[0]!.name).toContain('Álbuns de');
  });
});
