import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { wishlist } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import type { CommandArgumentSpec } from "@girae/common/commands";
import { resolveCommandArguments } from "../../services/commandArguments";
import WlcatCommand from "../../commands/all/wlcat.cards";

mockTelegram();

describe("/wlcat adds a whole subcategory to the wishlist, add-only", () => {
  const fx = new TestFixtures();
  let userId: number;
  let subcategoryId: number;
  let alreadyOnListCardId: number, notOnListCardId: number;
  const authorId = 'test-wlcat-author';

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test Wlcat", platformId: authorId })).id;
    const categoryId = (await fx.category({ name: "Test Wlcat Category" })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Wlcat Subcategory" })).id;

    alreadyOnListCardId = (await fx.card({ name: "Wlcat Already Listed", subcategoryId })).id;
    notOnListCardId = (await fx.card({ name: "Wlcat Not Listed", subcategoryId })).id;

    await CardsDB.addToWishlist(userId, alreadyOnListCardId);
    await CardsDB.addSubcategoryAlias(subcategoryId, 'wlcattestalias');

    // safety net: must run before fx.cleanup() deletes the cards - registered last so
    // it runs first in LIFO cleanup order.
    fx.onCleanup(async () => { await db.delete(wishlist).where(eq(wishlist.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  function ctx(args: string[] = [String(subcategoryId)]) {
    return fakeCtx({ name: 'wlcat', args, authorId });
  }

  test("adds cards missing from the wishlist and leaves already-listed ones alone", async () => {
    const subcategory = (await CardsDB.getSubcategory(subcategoryId))!;
    await WlcatCommand.execute(ctx(), { subcategory });

    expect(await CardsDB.isOnWishlist(userId, alreadyOnListCardId)).toBe(true);
    expect(await CardsDB.isOnWishlist(userId, notOnListCardId)).toBe(true);
  });

  test("running it again when everything is already listed adds nothing new (no removals)", async () => {
    const subcategory = (await CardsDB.getSubcategory(subcategoryId))!;
    await WlcatCommand.execute(ctx(), { subcategory });

    expect(await CardsDB.isOnWishlist(userId, alreadyOnListCardId)).toBe(true);
    expect(await CardsDB.isOnWishlist(userId, notOnListCardId)).toBe(true);
  });

  // exercises the real dispatch path (resolveCommandArguments -> execute), not a hand-built arg,
  // to prove /wlcat resolves subcategory aliases the same way /clc does.
  test("resolves the subcategory by alias through the real argument-parsing pipeline", async () => {
    await CardsDB.removeFromWishlist(userId, notOnListCardId);

    const specs = (WlcatCommand as any).commandArguments['execute'] as CommandArgumentSpec[];
    const resolved = await resolveCommandArguments(specs, ctx(['wlcattestalias']), WlcatCommand.info.usage);
    expect(resolved).not.toBeNull();

    await WlcatCommand.execute(ctx(['wlcattestalias']), resolved as any);

    expect(await CardsDB.isOnWishlist(userId, notOnListCardId)).toBe(true);
  });
});
