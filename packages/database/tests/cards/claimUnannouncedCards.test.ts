import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { CardsDB } from "../../cards";

describe("CardsDB.claimUnannouncedCards", () => {
  const fx = new TestFixtures();
  let categoryId: number;
  let subcategoryId: number;

  beforeAll(async () => {
    categoryId = (await fx.category({ name: `Test Claim Cards Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Claim Cards Subcategory" })).id;
    // mark the subcategory as already-announced first, so cards added below hit claimUnannouncedCards's own path, not the subcategory-claim auto-claim.
    await CardsDB.claimUnannouncedSubcategories(new Date(), [subcategoryId]);
  });

  afterAll(() => fx.cleanup());

  test("claims a new card added to an already-announced subcategory, grouped with rarity/subcategory/category emoji", async () => {
    const cardId = (await fx.card({ name: "Test Claim Card New", subcategoryId })).id;
    const cutoff = new Date();

    const firstRun = await CardsDB.claimUnannouncedCards(cutoff, [cardId]);
    expect(firstRun).toHaveLength(1);
    const row = firstRun[0]!;
    expect(row.id).toBe(cardId);
    expect(row.subcategoryId).toBe(subcategoryId);
    expect(row.rarityEmoji).toBeTruthy();
    expect(row.subcategoryEmoji).toBeTruthy();
    expect(row.subcategoryName).toBe("Test Claim Cards Subcategory");

    const secondRun = await CardsDB.claimUnannouncedCards(cutoff, [cardId]);
    expect(secondRun).toHaveLength(0);
  });

  test("orders newly-claimed cards rarest-first, regardless of creation order", async () => {
    const common = await fx.rarity({ name: `Test Common ${Date.now()}`, weight: 1000 });
    const rare = await fx.rarity({ name: `Test Rare ${Date.now()}`, weight: 100 });
    const legendary = await fx.rarity({ name: `Test Legendary ${Date.now()}`, weight: 10 });

    const commonCardId = (await fx.card({ name: "Test Claim Ordered Common", rarityId: common.id, subcategoryId })).id;
    const rareCardId = (await fx.card({ name: "Test Claim Ordered Rare", rarityId: rare.id, subcategoryId })).id;
    const legendaryCardId = (await fx.card({ name: "Test Claim Ordered Legendary", rarityId: legendary.id, subcategoryId })).id;
    const cutoff = new Date();

    const claimed = await CardsDB.claimUnannouncedCards(cutoff, [commonCardId, rareCardId, legendaryCardId]);
    expect(claimed.map(c => c.id)).toEqual([legendaryCardId, rareCardId, commonCardId]);
  });

  test("a card younger than cutoff is not claimed", async () => {
    const cardId = (await fx.card({ name: "Test Claim Card Fresh", subcategoryId })).id;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const claimed = await CardsDB.claimUnannouncedCards(oneHourAgo, [cardId]);
    expect(claimed).toHaveLength(0);
  });
});
