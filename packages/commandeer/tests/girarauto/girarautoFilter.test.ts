import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram } from "@girae/tests";
import { db } from "@girae/database/index";
import { users, linkedAccounts } from "@girae/database/schemas/users";
import { categories, subcategories, cards, cardSubcategories, rarities, userCards, cardDrawHistory } from "@girae/database/schemas/cards";
import { eq, inArray } from "drizzle-orm";
import type { IncomingCommand } from "@girae/common/commands/types";
import GirarAutoCommand from "../../commands/all/girarauto.cards";

mockTelegram();

// /girarauto <qtd> <categoria> focus mode must work standalone (no /quero favorites needed).
describe("/girarauto category filter", () => {
  let userId: number;
  let rarityId: number;
  let categoryId: number;
  let subcategoryId: number;
  let cardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    rarityId = await db.select({ id: rarities.id }).from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({ displayName: "Test Girarauto Filter", avatarUrl: "" }).returning();
    userId = user!.id;
    await db.insert(linkedAccounts).values({ userId, platform: 'none', platformId: 'test-girarauto-filter-author' });

    const [category] = await db.insert(categories).values({ name: "Zzzyx Filter Category", emoji: "🧪", subcategoriesOnDraw: 1 }).returning();
    categoryId = category!.id;

    const [subcategory] = await db.insert(subcategories).values({ categoryId, name: "Zzzyx Filter Sub" }).returning();
    subcategoryId = subcategory!.id;

    const [card] = await db.insert(cards).values({ name: "Zzzyx Filter Card", rarityId }).returning();
    cardId = card!.id;
    await db.insert(cardSubcategories).values({ cardId, subcategoryId, isMain: true });
  });

  afterAll(async () => {
    await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cardSubcategories).where(eq(cardSubcategories.cardId, cardId));
    await db.delete(cards).where(eq(cards.id, cardId));
    await db.delete(subcategories).where(eq(subcategories.id, subcategoryId));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  function ctxFor(args: string[]): IncomingCommand {
    return {
      name: 'girarauto',
      args,
      workflowIDToBeAssigned: `test-girarauto-filter-${Date.now()}`,
      message: {
        id: 'msg-1',
        author: { id: 'test-girarauto-filter-author', name: 'Tester', avatarUrl: '' },
        chat: { id: 'chat-1', title: 'test' },
        content: `/girarauto ${args.join(' ')}`,
        timestamp: new Date(),
        platform: 'none',
      },
    };
  }

  test("works standalone with no /quero favorites, drawing within the named category", async () => {
    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);

    await GirarAutoCommand.execute(ctxFor(['1', 'Zzzyx', 'Filter', 'Category']));

    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after - before).toBe(1);

    const owned = await db.select().from(userCards).where(eq(userCards.userId, userId));
    expect(owned.map(c => c.cardId)).toContain(cardId);
  });

  test("an accent-insensitive/case-insensitive category name still resolves", async () => {
    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    await GirarAutoCommand.execute(ctxFor(['1', 'zzzyx', 'filter', 'category']));
    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after - before).toBe(1);
  });

  test("a hidden category is rejected", async () => {
    await db.update(categories).set({ isHidden: true }).where(eq(categories.id, categoryId));
    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);

    await GirarAutoCommand.execute(ctxFor(['1', 'Zzzyx', 'Filter', 'Category']));

    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after).toBe(before);

    await db.update(categories).set({ isHidden: false }).where(eq(categories.id, categoryId));
  });

  test("an unresolvable category name replies with the not-found message, spends nothing", async () => {
    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    await GirarAutoCommand.execute(ctxFor(['1', 'zzzznonexistentcategoryzzzz']));
    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after).toBe(before);
  });
});
