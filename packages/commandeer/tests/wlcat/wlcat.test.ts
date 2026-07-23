import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram } from "@girae/tests";
import { db } from "@girae/database/index";
import { users, linkedAccounts } from "@girae/database/schemas/users";
import { categories, subcategories, cards, cardSubcategories, rarities, wishlist } from "@girae/database/schemas/cards";
import { CardsDB } from "@girae/database/cards";
import { eq, inArray } from "drizzle-orm";
import type { IncomingCommand } from "@girae/common/commands/types";
import type { CommandArgumentSpec } from "@girae/common/commands";
import { resolveCommandArguments } from "../../services/commandArguments";
import WlcatCommand from "../../commands/all/wlcat.cards";

mockTelegram();

describe("/wlcat adds a whole subcategory to the wishlist, add-only", () => {
  let userId: number;
  let rarityId: number;
  let categoryId: number;
  let subcategoryId: number;
  let alreadyOnListCardId: number, notOnListCardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({ displayName: "Test Wlcat", avatarUrl: "" }).returning();
    userId = user!.id;
    await db.insert(linkedAccounts).values({ userId, platform: 'none', platformId: 'test-wlcat-author' });

    const [category] = await db.insert(categories).values({ name: "Test Wlcat Category", emoji: "🧪" }).returning();
    categoryId = category!.id;
    const [subcategory] = await db.insert(subcategories).values({ categoryId, name: "Test Wlcat Subcategory" }).returning();
    subcategoryId = subcategory!.id;

    const [a, b] = await db.insert(cards).values([
      { name: "Wlcat Already Listed", rarityId },
      { name: "Wlcat Not Listed", rarityId },
    ]).returning();
    alreadyOnListCardId = a!.id;
    notOnListCardId = b!.id;

    await db.insert(cardSubcategories).values([
      { cardId: alreadyOnListCardId, subcategoryId, isMain: true },
      { cardId: notOnListCardId, subcategoryId, isMain: true },
    ]);

    await CardsDB.addToWishlist(userId, alreadyOnListCardId);
    await CardsDB.addSubcategoryAlias(subcategoryId, 'wlcattestalias');
  });

  afterAll(async () => {
    await db.delete(wishlist).where(eq(wishlist.userId, userId));
    await db.delete(cardSubcategories).where(inArray(cardSubcategories.cardId, [alreadyOnListCardId, notOnListCardId]));
    await db.delete(cards).where(inArray(cards.id, [alreadyOnListCardId, notOnListCardId]));
    await db.delete(subcategories).where(eq(subcategories.id, subcategoryId));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  function ctx(args: string[] = [String(subcategoryId)]): IncomingCommand {
    return {
      name: 'wlcat',
      args,
      workflowIDToBeAssigned: `test-wlcat-${Date.now()}`,
      message: {
        id: 'msg-1',
        author: { id: 'test-wlcat-author', name: 'Tester', avatarUrl: '' },
        chat: { id: 'chat-1', title: 'test' },
        content: `/wlcat ${args.join(' ')}`,
        timestamp: new Date(),
        platform: 'none',
      },
    };
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
