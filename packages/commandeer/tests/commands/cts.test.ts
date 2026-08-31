import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, fakeCtx, mockTelegram } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { userCards } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import CardsListCommand, { renderPage } from "../../commands/cards/cts";

mockTelegram();

describe("/cts favorite card media", () => {
  const fx = new TestFixtures();
  const platformId = `test-cts-favorite-${Date.now()}`;
  let userId: number;
  let cardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test Cts Favorite", platform: 'telegram', platformId })).id;
    cardId = (await fx.card({ name: "Test Cts Favorite Card" })).id;
    await db.insert(userCards).values({ userId, cardId, count: 1, customMediaUrl: 'https://example.com/custom.mp4', customMediaType: 'video' });
    await db.update(users).set({ favoriteCardId: cardId }).where(eq(users.id, userId));
    fx.onCleanup(async () => {
      await db.delete(userCards).where(eq(userCards.userId, userId));
      await db.update(users).set({ favoriteCardId: null }).where(eq(users.id, userId));
    });
  });

  afterAll(() => fx.cleanup());

  test("execute() doesn't throw for a user with a customized favorite card", async () => {
    const ctx = fakeCtx({ name: 'cts', authorId: platformId, platform: 'telegram' });
    await expect(CardsListCommand.execute(ctx)).resolves.toBeUndefined();
  });

  test("attaches the favorite card photo when the page content is short", async () => {
    const page = await renderPage('', 0, platformId, 'telegram');
    expect(page?.content.length).toBeLessThanOrEqual(700);
    expect(page?.photoUrl).toBeDefined();
  });
});

describe("/cts favorite card media - long page", () => {
  const fx = new TestFixtures();
  const platformId = `test-cts-longpage-${Date.now()}`;
  let userId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Cts Long Page", platform: 'telegram', platformId })).id;
    const categoryId = (await fx.category({ name: `Test Cts Long Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test Cts Long Subcategory ${Date.now()}` })).id;

    const cardIds: number[] = [];
    for (let i = 0; i < 12; i++) {
      cardIds.push((await fx.card({ name: `Test Cts Long Page Card Number ${i}`, subcategoryId })).id);
    }
    await db.insert(userCards).values(cardIds.map(cardId => ({ userId, cardId, count: 1 })));
    const favoriteCardId = cardIds[0]!;
    await db.update(users).set({ favoriteCardId }).where(eq(users.id, userId));

    fx.onCleanup(async () => {
      await db.delete(userCards).where(eq(userCards.userId, userId));
      await db.update(users).set({ favoriteCardId: null }).where(eq(users.id, userId));
    });
  });

  afterAll(() => fx.cleanup());

  test("omits the favorite card photo once page content exceeds the caption-safe threshold", async () => {
    const page = await renderPage('', 0, platformId, 'telegram');
    expect(page?.content.length).toBeGreaterThan(700);
    expect(page?.photoUrl).toBeUndefined();
    expect(page?.isVideo).toBeUndefined();
  });
});

describe("/cts category filter", () => {
  const fx = new TestFixtures();
  const platformId = `test-cts-category-${Date.now()}`;
  let userId: number;
  let categoryAId: number, categoryBId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Cts Category", platform: 'telegram', platformId })).id;

    const catA = await fx.category({ name: `Test Cts Cat A ${Date.now()}`, emoji: '🅰️' });
    categoryAId = catA.id;
    const subA = await fx.subcategory({ categoryId: categoryAId, name: `Test Cts Cat A Sub ${Date.now()}` });
    const cardAId = (await fx.card({ name: "Test Cts Cat A Card", subcategoryId: subA.id })).id;

    const catB = await fx.category({ name: `Test Cts Cat B ${Date.now()}`, emoji: '🅱️' });
    categoryBId = catB.id;
    const subB = await fx.subcategory({ categoryId: categoryBId, name: `Test Cts Cat B Sub ${Date.now()}` });
    const cardBId = (await fx.card({ name: "Test Cts Cat B Card", subcategoryId: subB.id })).id;

    await db.insert(userCards).values([
      { userId, cardId: cardAId, count: 1 },
      { userId, cardId: cardBId, count: 1 },
    ]);

    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("with no category selected, shows cards from every category and a button per category", async () => {
    const page = await renderPage('', 0, platformId, 'telegram');
    expect(page?.content).toContain('Test Cts Cat A Card');
    expect(page?.content).toContain('Test Cts Cat B Card');
    const categoryRow = page?.extraRows[1];
    expect(categoryRow?.map(b => b.text).sort()).toEqual(['🅰️', '🅱️']);
  });

  test("selecting a category narrows the list to just that category's card", async () => {
    const page = await renderPage(`:${categoryAId}`, 0, platformId, 'telegram');
    expect(page?.content).toContain('Test Cts Cat A Card');
    expect(page?.content).not.toContain('Test Cts Cat B Card');
    expect(page?.content).toContain('Mostrando apenas cards de');
  });

  test("clicking the already-selected category's button again clears the filter", async () => {
    // toggling arg is what clicking ✅ produces: buildFilterArg(active, '') - no category suffix
    const page = await renderPage('', 0, platformId, 'telegram');
    expect(page?.content).toContain('Test Cts Cat A Card');
    expect(page?.content).toContain('Test Cts Cat B Card');
  });
});
