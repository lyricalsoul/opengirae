import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { CardsDB } from "../../cards";

describe("CardsDB.setSubcategoryCardsTradable", () => {
  const fx = new TestFixtures();
  let userId: number;
  let subcategoryId: number;
  let inSubOwnedAId: number, inSubOwnedBId: number, inSubNotOwnedId: number, outsideSubOwnedId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test SubTradable" })).id;
    const categoryId = (await fx.category({ name: "Test SubTradable Category" })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test SubTradable Sub" })).id;
    const otherSubcategoryId = (await fx.subcategory({ categoryId, name: "Test SubTradable Other Sub" })).id;

    inSubOwnedAId = (await fx.card({ name: "Test SubTradable In-Sub Owned A", subcategoryId })).id;
    inSubOwnedBId = (await fx.card({ name: "Test SubTradable In-Sub Owned B", subcategoryId })).id;
    inSubNotOwnedId = (await fx.card({ name: "Test SubTradable In-Sub Not Owned", subcategoryId })).id;
    outsideSubOwnedId = (await fx.card({ name: "Test SubTradable Outside Sub Owned", subcategoryId: otherSubcategoryId })).id;

    await fx.ownCard(userId, inSubOwnedAId, 1);
    await fx.ownCard(userId, inSubOwnedBId, 1);
    await fx.ownCard(userId, outsideSubOwnedId, 1);
  });

  afterAll(() => fx.cleanup());

  test("marks only the owned cards within the subcategory, skipping unowned and out-of-subcategory ones", async () => {
    const cardIds = await CardsDB.setSubcategoryCardsTradable(userId, subcategoryId, true);
    expect(new Set(cardIds)).toEqual(new Set([inSubOwnedAId, inSubOwnedBId]));

    expect(await CardsDB.isCardTradable(userId, inSubOwnedAId)).toBe(true);
    expect(await CardsDB.isCardTradable(userId, inSubOwnedBId)).toBe(true);
    expect(await CardsDB.isCardTradable(userId, inSubNotOwnedId)).toBe(false);
    expect(await CardsDB.isCardTradable(userId, outsideSubOwnedId)).toBe(false);
  });

  test("setting tradable=false reverts just the same set", async () => {
    const cardIds = await CardsDB.setSubcategoryCardsTradable(userId, subcategoryId, false);
    expect(new Set(cardIds)).toEqual(new Set([inSubOwnedAId, inSubOwnedBId]));

    expect(await CardsDB.isCardTradable(userId, inSubOwnedAId)).toBe(false);
    expect(await CardsDB.isCardTradable(userId, inSubOwnedBId)).toBe(false);
  });

  test("returns an empty array when the user owns nothing in the subcategory", async () => {
    const emptySubcategoryId = (await fx.subcategory({ categoryId: (await fx.category({ name: "Test SubTradable Empty Category" })).id, name: "Test SubTradable Empty Sub" })).id;
    const cardIds = await CardsDB.setSubcategoryCardsTradable(userId, emptySubcategoryId, true);
    expect(cardIds).toEqual([]);
  });
});
