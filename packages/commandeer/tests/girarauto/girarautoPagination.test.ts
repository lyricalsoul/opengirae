import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram } from "@girae/tests";
import { db } from "@girae/database/index";
import { users, linkedAccounts } from "@girae/database/schemas/users";
import { categories, subcategories, cards, cardSubcategories, rarities, userCards, cardDrawHistory } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import type { IncomingCommand } from "@girae/common/commands/types";
import GirarAutoCommand from "../../commands/all/girarauto.cards";

mockTelegram();

// /girarauto <n> with n large enough to span multiple pages must not dump every card into one
// message - it caches the batch and paginates through the @Page handler instead.
describe("/girarauto pagination", () => {
  let userId: number;
  let rarityId: number;
  let categoryId: number;
  let subcategoryId: number;
  let cardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    rarityId = await db.select({ id: rarities.id }).from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({ displayName: "Test Girarauto Pagination", avatarUrl: "", maxDraws: 200 }).returning();
    userId = user!.id;
    await db.insert(linkedAccounts).values({ userId, platform: 'none', platformId: 'test-girarauto-pagination-author' });

    const [category] = await db.insert(categories).values({ name: "Zzzyx Pagination Category", emoji: "🧪", subcategoriesOnDraw: 1 }).returning();
    categoryId = category!.id;

    const [subcategory] = await db.insert(subcategories).values({ categoryId, name: "Zzzyx Pagination Sub" }).returning();
    subcategoryId = subcategory!.id;

    const [card] = await db.insert(cards).values({ name: "Zzzyx Pagination Card", rarityId }).returning();
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

  function ctxFor(args: string[], workflowID: string): IncomingCommand {
    return {
      name: 'girarauto',
      args,
      workflowIDToBeAssigned: workflowID,
      message: {
        id: 'msg-1',
        author: { id: 'test-girarauto-pagination-author', name: 'Tester', avatarUrl: '' },
        chat: { id: 'chat-1', title: 'test' },
        content: `/girarauto ${args.join(' ')}`,
        timestamp: new Date(),
        platform: 'none',
      },
    };
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
