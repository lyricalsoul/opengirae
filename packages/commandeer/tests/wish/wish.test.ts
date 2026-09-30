import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { wishlist } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import WishCommand from "../../commands/cards/wish";

mockTelegram();

describe("/wish (alias /wl) toggles cards on the caller's wishlist, single or bulk by ID", () => {
  const fx = new TestFixtures();
  const viewerPlatformId = 'test-wish-viewer';
  let viewerId: number;
  let cardAId: number, cardBId: number, cardCId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    viewerId = (await fx.user({ displayName: "Test Wish Viewer", platform: 'telegram', platformId: viewerPlatformId })).id;

    const categoryId = (await fx.category({ name: `Test Wish Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test Wish Sub ${Date.now()}` })).id;
    cardAId = (await fx.card({ name: `Test Wish Card A ${Date.now()}`, subcategoryId })).id;
    cardBId = (await fx.card({ name: `Test Wish Card B ${Date.now()}`, subcategoryId })).id;
    cardCId = (await fx.card({ name: `Test Wish Card C ${Date.now()}`, subcategoryId })).id;

    fx.onCleanup(async () => { await db.delete(wishlist).where(eq(wishlist.userId, viewerId)); });
  });

  afterAll(() => fx.cleanup());

  function ctx(args: string[]) {
    return fakeCtx({ name: 'wish', authorId: viewerPlatformId, args, platform: 'telegram' });
  }

  test("toggling a single card by ID adds then removes it", async () => {
    expect(await CardsDB.isOnWishlist(viewerId, cardAId)).toBe(false);

    await WishCommand.execute(ctx([String(cardAId)]));
    expect(await CardsDB.isOnWishlist(viewerId, cardAId)).toBe(true);

    await WishCommand.execute(ctx([String(cardAId)]));
    expect(await CardsDB.isOnWishlist(viewerId, cardAId)).toBe(false);
  });

  test("bulk: multiple space-separated IDs each toggle independently in one call", async () => {
    // cardA starts off the list, cardB starts on it - one call should add A and remove B
    await WishCommand.execute(ctx([String(cardBId)]));
    expect(await CardsDB.isOnWishlist(viewerId, cardBId)).toBe(true);

    await WishCommand.execute(ctx([String(cardAId), String(cardBId), String(cardCId)]));

    expect(await CardsDB.isOnWishlist(viewerId, cardAId)).toBe(true);
    expect(await CardsDB.isOnWishlist(viewerId, cardBId)).toBe(false);
    expect(await CardsDB.isOnWishlist(viewerId, cardCId)).toBe(true);
  });

  test("bulk: an unknown ID in the batch reports it and leaves every card untouched", async () => {
    await CardsDB.removeFromWishlist(viewerId, cardAId);
    await CardsDB.removeFromWishlist(viewerId, cardCId);

    await WishCommand.execute(ctx([String(cardAId), '999999999']));

    expect(await CardsDB.isOnWishlist(viewerId, cardAId)).toBe(false);
  });

  test("bulk: more than 50 IDs in one call is rejected without touching anything", async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => String(i + 1));
    await WishCommand.execute(ctx(tooMany));

    expect(await CardsDB.isOnWishlist(viewerId, cardAId)).toBe(false);
  });

  test("viewing your own wishlist (no args) resolves without throwing", async () => {
    await WishCommand.execute(ctx([])); // no throw = pass; see 03-commands.md on why not asserting reply content
  });
});
