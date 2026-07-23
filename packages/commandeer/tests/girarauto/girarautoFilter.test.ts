import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { categories, userCards, cardDrawHistory } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import GirarAutoCommand from "../../commands/all/girarauto.cards";

mockTelegram();

// /girarauto <qtd> <categoria> focus mode must work standalone (no /quero favorites needed).
describe("/girarauto category filter", () => {
  const fx = new TestFixtures();
  let userId: number;
  let categoryId: number;
  let cardId: number;
  const authorId = 'test-girarauto-filter-author';

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test Girarauto Filter", platformId: authorId })).id;
    categoryId = (await fx.category({ name: "Zzzyx Filter Category", emoji: "🧪" })).id;
    await db.update(categories).set({ subcategoriesOnDraw: 1 }).where(eq(categories.id, categoryId));
    const subcategoryId = (await fx.subcategory({ categoryId, name: "Zzzyx Filter Sub" })).id;
    cardId = (await fx.card({ name: "Zzzyx Filter Card", subcategoryId })).id;

    fx.onCleanup(async () => {
      await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
      await db.delete(userCards).where(eq(userCards.userId, userId));
    });
  });

  afterAll(() => fx.cleanup());

  function ctxFor(args: string[]) {
    return fakeCtx({ name: 'girarauto', authorId, args });
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
