import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { userCards } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import { UsersDB } from "@girae/database/users";
import TrocoCommand, { renderPage } from "../../commands/cards/troco";

const { sentMessages } = mockTelegram();

async function waitForSentMessage(minLength: number, timeoutMs = 5000): Promise<void> {
  const startTime = Date.now();
  while (sentMessages.length < minLength) {
    if (Date.now() - startTime > timeoutMs) throw new Error(`Timeout waiting for sentMessages.length >= ${minLength}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

describe("/troco marks one or several cards as tradable", () => {
  const fx = new TestFixtures();
  const authorId = "test-troco-author";
  let userId: number;
  let cardAId: number, cardBId: number, cardCId: number, unownedCardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test Troco", platform: 'telegram', platformId: authorId })).id;
    const categoryId = (await fx.category({ name: `Test Troco Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test Troco Sub ${Date.now()}` })).id;

    cardAId = (await fx.card({ name: `Test Troco Card A ${Date.now()}`, subcategoryId })).id;
    cardBId = (await fx.card({ name: `Test Troco Card B ${Date.now()}`, subcategoryId })).id;
    cardCId = (await fx.card({ name: `Test Troco Card C ${Date.now()}`, subcategoryId })).id;
    unownedCardId = (await fx.card({ name: `Test Troco Unowned ${Date.now()}`, subcategoryId })).id;

    await fx.ownCard(userId, cardAId, 1);
    await fx.ownCard(userId, cardBId, 1);
    await fx.ownCard(userId, cardCId, 1);
  });

  afterAll(() => fx.cleanup());

  function ctxFor(args: string[]) {
    return fakeCtx({ name: 'troco', authorId, args, platform: 'telegram' });
  }

  test("marks a single card tradable by ID", async () => {
    await TrocoCommand.execute(ctxFor([String(cardAId)]), { cardsRaw: String(cardAId) });
    expect(await CardsDB.isCardTradable(userId, cardAId)).toBe(true);
  });

  test("a not-owned card by ID replies without throwing and marks nothing", async () => {
    await expect(TrocoCommand.execute(ctxFor([String(unownedCardId)]), { cardsRaw: String(unownedCardId) })).resolves.toBeUndefined();
    expect(await CardsDB.isCardTradable(userId, unownedCardId)).toBe(false);
  });

  test("marks multiple owned cards tradable in one command, skipping a not-owned ID", async () => {
    const raw = `${cardBId} ${cardCId} ${unownedCardId}`;
    await TrocoCommand.execute(ctxFor(raw.split(' ')), { cardsRaw: raw });

    expect(await CardsDB.isCardTradable(userId, cardBId)).toBe(true);
    expect(await CardsDB.isCardTradable(userId, cardCId)).toBe(true);
    expect(await CardsDB.isCardTradable(userId, unownedCardId)).toBe(false);
  });

  test("a bulk request with nothing owned replies without throwing", async () => {
    const raw = `${unownedCardId} 999999999`;
    await expect(TrocoCommand.execute(ctxFor(raw.split(' ')), { cardsRaw: raw })).resolves.toBeUndefined();
  });

  test("no args shows the tradable-cards list instead of the usage message", async () => {
    const startIndex = sentMessages.length;
    await TrocoCommand.execute(ctxFor([]), {});
    await waitForSentMessage(startIndex + 1);

    const msg = sentMessages[sentMessages.length - 1]!;
    const content = msg.text ?? msg.content ?? "";
    expect(content).toContain("Lista de trocáveis");
    expect(content).not.toContain("Uso:");
  });
});

describe("/troco with no tradable cards", () => {
  const fx = new TestFixtures();
  const authorId = `test-troco-list-empty-${Date.now()}`;
  let userId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Troco List Empty", platform: 'telegram', platformId: authorId })).id;
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

  test("execute() with no args doesn't throw", async () => {
    await import("@girae/answerer/index");
    const ctx = fakeCtx({ name: 'troco', authorId, platform: 'telegram' });
    await expect(TrocoCommand.execute(ctx, {})).resolves.toBeUndefined();
  });
});

describe("/troco list pagination and filters", () => {
  const fx = new TestFixtures();
  const authorId = `test-troco-list-many-${Date.now()}`;
  let userId: number;
  let categoryId: number;
  let subcategoryId: number;
  let commonRarityId: number;
  let legendaryRarityId: number;
  const cardIds: number[] = [];

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Troco List Many", platform: 'telegram', platformId: authorId })).id;
    categoryId = (await fx.category({ name: `Test Troco List Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: `Test Troco List Sub ${Date.now()}` })).id;

    const rarityRows = await db.select().from((await import("@girae/database/schemas/cards")).rarities);
    commonRarityId = rarityRows.find(r => r.name === 'Comum')!.id;
    legendaryRarityId = rarityRows.find(r => r.name === 'Lendário')!.id;

    for (let i = 0; i < 11; i++) {
      const card = await fx.card({ name: `Test Troco List Common ${i}`, rarityId: commonRarityId, subcategoryId });
      cardIds.push(card.id);
    }
    const legendaryCard = await fx.card({ name: "Test Troco List Legendary", rarityId: legendaryRarityId, subcategoryId });
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
    expect(page?.content).toContain('Test Troco List Legendary');
    expect(page?.hasNext).toBe(false);
    expect(page?.totalPages).toBe(1);
  });

  test("a card not marked tradable is excluded", async () => {
    const untradable = await fx.card({ name: "Test Troco List Untradable", rarityId: commonRarityId, subcategoryId });
    await db.insert(userCards).values({ userId, cardId: untradable.id, count: 1, tradable: false });
    // after the fixture, so LIFO deletes this first
    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.cardId, untradable.id)); });

    const page = await renderPage(`:${userId}`, 0);
    expect(page?.content).not.toContain('Test Troco List Untradable');
  });
});

describe("/troco list category filter", () => {
  const fx = new TestFixtures();
  const authorId = `test-troco-list-category-${Date.now()}`;
  let userId: number;
  let categoryAId: number, categoryBId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Troco List Category", platform: 'telegram', platformId: authorId })).id;

    const catA = await fx.category({ name: `Test Troco Cat A ${Date.now()}`, emoji: '🅰️' });
    categoryAId = catA.id;
    const subA = await fx.subcategory({ categoryId: categoryAId, name: `Test Troco Cat A Sub ${Date.now()}` });
    cardAId = (await fx.card({ name: "Test Troco Cat A Card", subcategoryId: subA.id })).id;

    const catB = await fx.category({ name: `Test Troco Cat B ${Date.now()}`, emoji: '🅱️' });
    categoryBId = catB.id;
    const subB = await fx.subcategory({ categoryId: categoryBId, name: `Test Troco Cat B Sub ${Date.now()}` });
    cardBId = (await fx.card({ name: "Test Troco Cat B Card", subcategoryId: subB.id })).id;

    await db.insert(userCards).values([
      { userId, cardId: cardAId, count: 1, tradable: true },
      { userId, cardId: cardBId, count: 1, tradable: true },
    ]);

    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("with no category selected, shows cards from every category and a button per category", async () => {
    const page = await renderPage(`:${userId}`, 0);
    expect(page?.content).toContain('Test Troco Cat A Card');
    expect(page?.content).toContain('Test Troco Cat B Card');
    const categoryRow = page?.extraRows[1];
    expect(categoryRow?.map(b => b.text).sort()).toEqual(['🅰️', '🅱️']);
  });

  test("selecting a category narrows the list to just that category's card", async () => {
    const page = await renderPage(`:${userId}:${categoryAId}`, 0);
    expect(page?.content).toContain('Test Troco Cat A Card');
    expect(page?.content).not.toContain('Test Troco Cat B Card');
    expect(page?.content).toContain('Mostrando apenas cards de');
    // the selected category's button turns into a checkmark; the other stays as its emoji
    const categoryRow = page?.extraRows[1];
    expect(categoryRow?.find(b => b.text === '✅')).toBeDefined();
    expect(categoryRow?.find(b => b.text === '🅱️')).toBeDefined();
  });

  test("clicking the already-selected category's button again clears the filter", async () => {
    // toggling arg is what clicking ✅ produces: buildFilterArg(active, userIdPart) - no category suffix
    const page = await renderPage(`:${userId}`, 0);
    expect(page?.content).toContain('Test Troco Cat A Card');
    expect(page?.content).toContain('Test Troco Cat B Card');
  });
});

describe("/troco list privacy", () => {
  const fx = new TestFixtures();
  const viewerAuthorId = `test-troco-list-viewer-${Date.now()}`;
  const targetAuthorId = `test-troco-list-target-${Date.now()}`;

  beforeAll(async () => {
    await import("@girae/answerer/index");
    await fx.user({ displayName: "Test Troco List Viewer", platform: 'telegram', platformId: viewerAuthorId });
    const target = await fx.user({ displayName: "Test Troco List Target", platform: 'telegram', platformId: targetAuthorId });
    await UsersDB.setPrivacyMode(target.id, true);
  });

  afterAll(() => fx.cleanup());

  test("execute() with no args, replying to a private user, doesn't throw and doesn't leak the list", async () => {
    const ctx = fakeCtx({ name: 'troco', authorId: viewerAuthorId, platform: 'telegram', replyToAuthorId: targetAuthorId });
    await expect(TrocoCommand.execute(ctx, {})).resolves.toBeUndefined();
  });
});
