import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { wishlist } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import WishFaltanteClcCommand from "../../commands/cards/wishfaltanteclc";

mockTelegram();

describe("/wishfaltanteclc adds every missing card in a collection to the wishlist", () => {
  const fx = new TestFixtures();
  const userPlatformId = "test-wishfaltanteclc-user";
  let userId: number;
  let subcategoryId: number;
  let ownedCardId: number, missingCardAId: number, missingCardBId: number, alreadyWishedCardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test WishFaltanteClc User", platform: 'telegram', platformId: userPlatformId })).id;

    const categoryId = (await fx.category({ name: `Test WishFaltanteClc Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: `Test WishFaltanteClc Sub ${Date.now()}` })).id;

    ownedCardId = (await fx.card({ name: `Test WishFaltanteClc Owned ${Date.now()}`, subcategoryId })).id;
    missingCardAId = (await fx.card({ name: `Test WishFaltanteClc Missing A ${Date.now()}`, subcategoryId })).id;
    missingCardBId = (await fx.card({ name: `Test WishFaltanteClc Missing B ${Date.now()}`, subcategoryId })).id;
    alreadyWishedCardId = (await fx.card({ name: `Test WishFaltanteClc Already Wished ${Date.now()}`, subcategoryId })).id;

    await fx.ownCard(userId, ownedCardId, 1);
    await CardsDB.addToWishlist(userId, alreadyWishedCardId);

    fx.onCleanup(async () => { await db.delete(wishlist).where(eq(wishlist.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  function ctxFor() {
    return fakeCtx({ name: 'wishfaltanteclc', authorId: userPlatformId, args: [String(subcategoryId)], platform: 'telegram' });
  }

  test("adds every missing card to the wishlist, skips what's owned and what's already on it", async () => {
    const subcategory = await CardsDB.getSubcategory(subcategoryId);
    await WishFaltanteClcCommand.execute(ctxFor(), { subcategory: subcategory! });

    expect(await CardsDB.isOnWishlist(userId, missingCardAId)).toBe(true);
    expect(await CardsDB.isOnWishlist(userId, missingCardBId)).toBe(true);
    expect(await CardsDB.isOnWishlist(userId, alreadyWishedCardId)).toBe(true);
    expect(await CardsDB.isOnWishlist(userId, ownedCardId)).toBe(false);
  });
});

describe("/wishfaltanteclc when every card in the collection is already owned", () => {
  const fx = new TestFixtures();
  const userPlatformId = `test-wishfaltanteclc-complete-${Date.now()}`;
  let userId: number;
  let subcategoryId: number;
  let cardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test WishFaltanteClc Complete", platform: 'telegram', platformId: userPlatformId })).id;
    const categoryId = (await fx.category({ name: `Test WishFaltanteClc Complete Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: `Test WishFaltanteClc Complete Sub ${Date.now()}` })).id;
    cardId = (await fx.card({ name: `Test WishFaltanteClc Complete Card ${Date.now()}`, subcategoryId })).id;
    await fx.ownCard(userId, cardId, 1);
  });

  afterAll(() => fx.cleanup());

  test("resolves without throwing and adds nothing to the wishlist", async () => {
    const subcategory = await CardsDB.getSubcategory(subcategoryId);
    const ctx = fakeCtx({ name: 'wishfaltanteclc', authorId: userPlatformId, args: [String(subcategoryId)], platform: 'telegram' });
    await WishFaltanteClcCommand.execute(ctx, { subcategory: subcategory! });
    expect(await CardsDB.isOnWishlist(userId, cardId)).toBe(false);
  });
});
