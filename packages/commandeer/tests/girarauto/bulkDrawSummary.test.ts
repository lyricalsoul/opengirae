import { test, expect, describe } from "bun:test";
import type { BulkDrawResult } from "@girae/database/gacha";
import { buildBulkDrawSummary, renderBulkDrawSummaryPage } from "../../services/gacha/bulkDrawSummary";

function result(overrides: Partial<BulkDrawResult> & { id: number; rarityWeight: number }): BulkDrawResult {
  return {
    card: { id: overrides.id, name: `Card ${overrides.id}`, rarityModifier: 100, rarityWeight: overrides.rarityWeight, rarityEmoji: '🃏', imageUrl: null, rank: 1 },
    categoryId: 1,
    categoryName: 'Test Category',
    categoryEmoji: '🎨',
    subcategoryId: 1,
    subcategoryName: 'Test Sub',
    isFromFavorite: false,
    ...overrides,
  };
}

describe("buildBulkDrawSummary ordering", () => {
  test("sorts results by rarity, rarest (lowest weight) first", async () => {
    const results = [result({ id: 1, rarityWeight: 100 }), result({ id: 2, rarityWeight: 1 }), result({ id: 3, rarityWeight: 50 })];
    const summary = await buildBulkDrawSummary(results, { splitFavorites: false });
    expect(summary.ordered.map(r => r.card.id)).toEqual([2, 3, 1]);
  });

  test("with splitFavorites, favorites stay first as a group, each group sorted by rarity", async () => {
    const results = [
      result({ id: 1, rarityWeight: 100, isFromFavorite: false }),
      result({ id: 2, rarityWeight: 1, isFromFavorite: true }),
      result({ id: 3, rarityWeight: 50, isFromFavorite: true }),
      result({ id: 4, rarityWeight: 10, isFromFavorite: false }),
    ];
    const summary = await buildBulkDrawSummary(results, { splitFavorites: true });
    expect(summary.ordered.map(r => r.card.id)).toEqual([2, 3, 4, 1]);
  });
});

describe("renderBulkDrawSummaryPage line format", () => {
  test("category emoji sits between the card name and the subcategory name", async () => {
    const results = [result({ id: 1, rarityWeight: 100, categoryEmoji: '🎨', subcategoryName: 'Test Sub' })];
    const summary = await buildBulkDrawSummary(results, { splitFavorites: false });
    const { content } = renderBulkDrawSummaryPage(summary, 0);
    expect(content).toContain('**Card 1** 🎨 _Test Sub_');
  });

  test("a favorite draw ends with the 💝 marker, a non-favorite doesn't", async () => {
    const results = [result({ id: 1, rarityWeight: 100, isFromFavorite: true }), result({ id: 2, rarityWeight: 1, isFromFavorite: false })];
    const summary = await buildBulkDrawSummary(results, { splitFavorites: false });
    const { content } = renderBulkDrawSummaryPage(summary, 0);
    expect(content).toContain('_Test Sub_ 💝');
    expect(content).not.toContain('**Card 2** 🎨 _Test Sub_ 💝');
  });
});
