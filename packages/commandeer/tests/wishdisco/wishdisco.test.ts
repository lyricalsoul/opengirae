import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DiscotecaDB } from "@girae/database/discoteca";
import { UsersDB } from "@girae/database/users";
import { db } from "@girae/database/index";
import { discotecaWishlist } from "@girae/database/schemas/discoteca";
import { eq } from "drizzle-orm";
import WishDiscoCommand from "../../commands/discoteca/wishdisco";

mockTelegram();

describe("/wishdisco toggles discoteca entries on the caller's wishlist and browses it", () => {
  const fx = new TestFixtures();
  const viewerPlatformId = 'test-wishdisco-viewer';
  const otherPlatformId = 'test-wishdisco-other';
  let viewerId: number, otherId: number;
  let entryId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers(); // needed so WishDiscoCommand's reply() has a worker to complete against

    viewerId = (await fx.user({ displayName: "Test Wishdisco Viewer", platform: 'telegram', platformId: viewerPlatformId })).id;
    otherId = (await fx.user({ displayName: "Test Wishdisco Other", platform: 'telegram', platformId: otherPlatformId })).id;
    entryId = (await fx.discotecaEntry({ name: `Test Wishdisco Entry ${Date.now()}` })).id;

    fx.onCleanup(async () => { await db.delete(discotecaWishlist).where(eq(discotecaWishlist.userId, viewerId)); });
  });

  afterAll(() => fx.cleanup());

  function ctx(authorId: string, args: string[] = [], replyToAuthorId?: string) {
    return fakeCtx({ name: 'wishdisco', authorId, args, platform: 'telegram', replyToAuthorId });
  }

  test("toggling by ID adds then removes the entry from the wishlist", async () => {
    expect(await DiscotecaDB.isOnWishlist(viewerId, entryId)).toBe(false);

    await WishDiscoCommand.execute(ctx(viewerPlatformId, [String(entryId)]));
    expect(await DiscotecaDB.isOnWishlist(viewerId, entryId)).toBe(true);

    await WishDiscoCommand.execute(ctx(viewerPlatformId, [String(entryId)]));
    expect(await DiscotecaDB.isOnWishlist(viewerId, entryId)).toBe(false);
  });

  test("viewing your own wishlist (no args) resolves without throwing", async () => {
    await WishDiscoCommand.execute(ctx(viewerPlatformId)); // no throw = pass; see 03-commands.md on why not asserting reply content
  });

  test("viewing another (non-private) user's wishlist via reply-to resolves without throwing", async () => {
    await WishDiscoCommand.execute(ctx(viewerPlatformId, [], otherPlatformId));
  });

  test("reaches the privacy-block branch for a private target's wishlist, without throwing", async () => {
    await UsersDB.setPrivacyMode(otherId, true);
    await WishDiscoCommand.execute(ctx(viewerPlatformId, [], otherPlatformId));
    await UsersDB.setPrivacyMode(otherId, false);
  });

  test("an unresolvable entry name replies with a not-found message and doesn't touch the wishlist", async () => {
    await WishDiscoCommand.execute(ctx(viewerPlatformId, ['this entry definitely does not exist 12345']));
    expect(await DiscotecaDB.isOnWishlist(viewerId, entryId)).toBe(false);
  });
});
