import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { categories, userCards, cardDrawHistory } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import GirarAutoCommand from "../../commands/all/girarauto.cards";

mockTelegram();

// /girarauto <n> with n large enough to span multiple pages must not dump every card into one
// message - it caches the batch and paginates through the @Page handler instead.
describe("/girarauto pagination", () => {
  const fx = new TestFixtures();
  let userId: number;
  const authorId = 'test-girarauto-pagination-author';

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test Girarauto Pagination", platformId: authorId })).id;
    await db.update(users).set({ maxDraws: 200 }).where(eq(users.id, userId));

    const categoryId = (await fx.category({ name: "Zzzyx Pagination Category", emoji: "🧪" })).id;
    await db.update(categories).set({ subcategoriesOnDraw: 1 }).where(eq(categories.id, categoryId));

    const subcategoryId = (await fx.subcategory({ categoryId, name: "Zzzyx Pagination Sub" })).id;
    await fx.card({ name: "Zzzyx Pagination Card", subcategoryId });

    fx.onCleanup(async () => {
      await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
      await db.delete(userCards).where(eq(userCards.userId, userId));
    });
  });

  afterAll(() => fx.cleanup());

  function ctxFor(args: string[], workflowID: string) {
    return fakeCtx({ name: 'girarauto', authorId, args, workflowID });
  }

  test("a 50-draw batch caches results and the @Page handler serves page 2 correctly", async () => {
    const workflowID = `test-girarauto-pagination-${Date.now()}`;
    await GirarAutoCommand.execute(ctxFor(['50', 'Zzzyx', 'Pagination', 'Category'], workflowID));

    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after).toBe(50);

    // page 0 exists and reports more pages ahead (PAGE_SIZE=10, 50 results -> 5 pages)
    const page0 = await GirarAutoCommand.girarautoPage(workflowID, 0);
    expect(page0).not.toBeNull();
    expect(page0!.totalPages).toBe(5);
    expect(page0!.hasNext).toBe(true);

    const page4 = await GirarAutoCommand.girarautoPage(workflowID, 4);
    expect(page4).not.toBeNull();
    expect(page4!.hasNext).toBe(false);
    expect(page4!.content).toContain('Página `5` de **5**');
  });

  test("an unknown runId returns null (cache miss / expired)", async () => {
    const result = await GirarAutoCommand.girarautoPage('nonexistent-run-id', 0);
    expect(result).toBeNull();
  });
});
