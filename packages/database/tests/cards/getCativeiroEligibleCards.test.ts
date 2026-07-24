import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { CardsDB } from "../../cards";

describe("CardsDB.getCativeiroEligibleCards", () => {
  const fx = new TestFixtures();
  let userId: number;
  let rarityId: number;
  let cardBelowId: number;
  let cardAtId: number;
  let categoryId: number;
  let subcategoryId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Cativeiro Eligibility" })).id;
    rarityId = (await fx.rarity({ name: "Test Cativeiro Rarity", cativeiroThreshold: 5 })).id;
    categoryId = (await fx.category({ name: "Test Cativeiro Category" })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Cativeiro Sub" })).id;

    cardBelowId = (await fx.card({ name: "Test Cativeiro Below", rarityId, subcategoryId })).id;
    cardAtId = (await fx.card({ name: "Test Cativeiro At", rarityId, subcategoryId })).id;

    await fx.ownCard(userId, cardBelowId, 4); // one short of the threshold
    await fx.ownCard(userId, cardAtId, 5); // exactly at the threshold
  });

  afterAll(() => fx.cleanup());

  test("excludes a card one copy short of the rarity's threshold", async () => {
    const { rows } = await CardsDB.getCativeiroEligibleCards(userId);
    expect(rows.some(r => r.id === cardBelowId)).toBe(false);
  });

  test("includes a card exactly at the rarity's threshold", async () => {
    const { rows, total } = await CardsDB.getCativeiroEligibleCards(userId);
    const row = rows.find(r => r.id === cardAtId);
    expect(row).toBeDefined();
    expect(row?.ownedCount).toBe(5);
    expect(total).toBe(1);
  });

  test("falls back to the category's emoji when the subcategory has none set", async () => {
    const { rows } = await CardsDB.getCativeiroEligibleCards(userId);
    const row = rows.find(r => r.id === cardAtId);
    const category = await CardsDB.getCategory(categoryId);
    expect(row?.subcategoryEmoji).toBe(category?.emoji);
  });
});
