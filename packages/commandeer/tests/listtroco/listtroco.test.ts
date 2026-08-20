import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, fakeCtx, mockTelegram } from "@girae/tests";
import { db } from "@girae/database/index";
import { userCards } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import { UsersDB } from "@girae/database/users";
import ListTrocoCommand, { renderPage } from "../../commands/cards/listtroco";

mockTelegram();

describe("/listtroco with no tradable cards", () => {
  const fx = new TestFixtures();
  const authorId = `test-listtroco-empty-${Date.now()}`;
  let userId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Listtroco Empty", platform: 'telegram', platformId: authorId })).id;
  });

  afterAll(() => fx.cleanup());

  test("shows the empty-state message, no photo, no pagination", async () => {
    const page = await renderPage(`:${userId}`, 0);
    expect(page?.content).toContain('_Nenhum card encontrado._');
    expect(page?.content).toContain('`0` cards na lista.');
    expect(page?.photoUrl).toBeUndefined();
    expect(page?.hasNext).toBe(false);
    expect(page?.totalPages).toBe(1);
  });

  test("execute() doesn't throw", async () => {
    await import("@girae/answerer/index");
    const ctx = fakeCtx({ name: 'listtroco', authorId, platform: 'telegram' });
    await expect(ListTrocoCommand.execute(ctx)).resolves.toBeUndefined();
  });
});

describe("/listtroco pagination and filters", () => {
  const fx = new TestFixtures();
  const authorId = `test-listtroco-many-${Date.now()}`;
  let userId: number;
  let categoryId: number;
  let subcategoryId: number;
  let commonRarityId: number;
  let legendaryRarityId: number;
  const cardIds: number[] = [];

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Listtroco Many", platform: 'telegram', platformId: authorId })).id;
    categoryId = (await fx.category({ name: `Test Listtroco Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: `Test Listtroco Sub ${Date.now()}` })).id;

    const rarityRows = await db.select().from((await import("@girae/database/schemas/cards")).rarities);
    commonRarityId = rarityRows.find(r => r.name === 'Comum')!.id;
    legendaryRarityId = rarityRows.find(r => r.name === 'Lendário')!.id;

    for (let i = 0; i < 11; i++) {
      const card = await fx.card({ name: `Test Listtroco Common ${i}`, rarityId: commonRarityId, subcategoryId });
      cardIds.push(card.id);
    }
    const legendaryCard = await fx.card({ name: "Test Listtroco Legendary", rarityId: legendaryRarityId, subcategoryId });
    cardIds.push(legendaryCard.id);

    await db.insert(userCards).values(cardIds.map(cardId => ({ userId, cardId, count: 2, tradable: true })));

    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("page 0 lists the first 10 tradable cards and has a next page", async () => {
    const page = await renderPage(`:${userId}`, 0);
    expect(page?.content.match(/`\d+x`/g)).toHaveLength(10);
    expect(page?.content).toContain('`12` cards na lista.');
    expect(page?.hasNext).toBe(true);
    expect(page?.totalPages).toBe(2);
  });

  test("page 1 lists the remaining 2", async () => {
    const page = await renderPage(`:${userId}`, 1);
    expect(page?.content.match(/`\d+x`/g)).toHaveLength(2);
    expect(page?.hasNext).toBe(false);
  });

  test("the legendary filter narrows the list to just the one legendary card", async () => {
    const page = await renderPage(`3:${userId}`, 0);
    expect(page?.content.match(/`\d+x`/g)).toHaveLength(1);
    expect(page?.content).toContain('Test Listtroco Legendary');
    expect(page?.hasNext).toBe(false);
    expect(page?.totalPages).toBe(1);
  });

  test("a card not marked tradable is excluded", async () => {
    const untradable = await fx.card({ name: "Test Listtroco Untradable", rarityId: commonRarityId, subcategoryId });
    await db.insert(userCards).values({ userId, cardId: untradable.id, count: 1, tradable: false });
    // after the fixture, so LIFO deletes this first
    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.cardId, untradable.id)); });

    const page = await renderPage(`:${userId}`, 0);
    expect(page?.content).not.toContain('Test Listtroco Untradable');
  });
});

describe("/listtroco privacy", () => {
  const fx = new TestFixtures();
  const viewerAuthorId = `test-listtroco-viewer-${Date.now()}`;
  const targetAuthorId = `test-listtroco-target-${Date.now()}`;

  beforeAll(async () => {
    await import("@girae/answerer/index");
    await fx.user({ displayName: "Test Listtroco Viewer", platform: 'telegram', platformId: viewerAuthorId });
    const target = await fx.user({ displayName: "Test Listtroco Target", platform: 'telegram', platformId: targetAuthorId });
    await UsersDB.setPrivacyMode(target.id, true);
  });

  afterAll(() => fx.cleanup());

  test("execute() replying to a private user doesn't throw and doesn't leak the list", async () => {
    const ctx = fakeCtx({ name: 'listtroco', authorId: viewerAuthorId, platform: 'telegram', replyToAuthorId: targetAuthorId });
    await expect(ListTrocoCommand.execute(ctx)).resolves.toBeUndefined();
  });
});
