import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import TrocoCatCommand from "../../commands/cards/trococat";
import NaoTrocoCatCommand from "../../commands/cards/naotrococat";

mockTelegram();

describe("/trococat and /naotrococat mark a whole collection tradable/not tradable", () => {
  const fx = new TestFixtures();
  const authorId = "test-trococat-author";
  let userId: number;
  let subcategoryId: number;
  let ownedAId: number, ownedBId: number, notOwnedId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test Trococat", platform: 'telegram', platformId: authorId })).id;
    const categoryId = (await fx.category({ name: `Test Trococat Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: `Test Trococat Sub ${Date.now()}` })).id;

    ownedAId = (await fx.card({ name: `Test Trococat Owned A ${Date.now()}`, subcategoryId })).id;
    ownedBId = (await fx.card({ name: `Test Trococat Owned B ${Date.now()}`, subcategoryId })).id;
    notOwnedId = (await fx.card({ name: `Test Trococat Not Owned ${Date.now()}`, subcategoryId })).id;

    await fx.ownCard(userId, ownedAId, 1);
    await fx.ownCard(userId, ownedBId, 1);
  });

  afterAll(() => fx.cleanup());

  function ctxFor(subId: number) {
    return fakeCtx({ name: 'trococat', authorId, args: [String(subId)], platform: 'telegram' });
  }

  test("/trococat marks every owned card in the collection as tradable", async () => {
    const subcategory = (await CardsDB.getSubcategory(subcategoryId))!;
    await TrocoCatCommand.execute(ctxFor(subcategoryId), { subcategory });

    expect(await CardsDB.isCardTradable(userId, ownedAId)).toBe(true);
    expect(await CardsDB.isCardTradable(userId, ownedBId)).toBe(true);
    expect(await CardsDB.isCardTradable(userId, notOwnedId)).toBe(false);
  });

  test("/naotrococat marks every owned card in the collection as not tradable", async () => {
    const subcategory = (await CardsDB.getSubcategory(subcategoryId))!;
    await NaoTrocoCatCommand.execute(ctxFor(subcategoryId), { subcategory });

    expect(await CardsDB.isCardTradable(userId, ownedAId)).toBe(false);
    expect(await CardsDB.isCardTradable(userId, ownedBId)).toBe(false);
  });

  test("/trococat on a collection with nothing owned replies without throwing", async () => {
    const emptyCategoryId = (await fx.category({ name: `Test Trococat Empty Category ${Date.now()}` })).id;
    const emptySubcategoryId = (await fx.subcategory({ categoryId: emptyCategoryId, name: `Test Trococat Empty Sub ${Date.now()}` })).id;
    const subcategory = (await CardsDB.getSubcategory(emptySubcategoryId))!;

    await TrocoCatCommand.execute(ctxFor(emptySubcategoryId), { subcategory });
  });
});
