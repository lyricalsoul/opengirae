import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import NaoTrocoCommand, { renderPage } from "../../commands/cards/naotroco";

const { sentMessages } = mockTelegram();

async function waitForSentMessage(minLength: number, timeoutMs = 5000): Promise<void> {
  const startTime = Date.now();
  while (sentMessages.length < minLength) {
    if (Date.now() - startTime > timeoutMs) throw new Error(`Timeout waiting for sentMessages.length >= ${minLength}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

describe("/naotroco marks one or several cards as non-tradable", () => {
  const fx = new TestFixtures();
  const authorId = "test-naotroco-author";
  let userId: number;
  let cardAId: number, cardBId: number, unownedCardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test NaoTroco", platform: 'telegram', platformId: authorId })).id;
    const categoryId = (await fx.category({ name: `Test NaoTroco Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test NaoTroco Sub ${Date.now()}` })).id;

    cardAId = (await fx.card({ name: `Test NaoTroco Card A ${Date.now()}`, subcategoryId })).id;
    cardBId = (await fx.card({ name: `Test NaoTroco Card B ${Date.now()}`, subcategoryId })).id;
    unownedCardId = (await fx.card({ name: `Test NaoTroco Unowned ${Date.now()}`, subcategoryId })).id;

    await fx.ownCard(userId, cardAId, 1);
    await fx.ownCard(userId, cardBId, 1);
    // tradable by default, exactly what /naotroco flips to false
    await CardsDB.setCardTradable(userId, cardAId, true);
    await CardsDB.setCardTradable(userId, cardBId, true);
  });

  afterAll(() => fx.cleanup());

  function ctxFor(args: string[]) {
    return fakeCtx({ name: 'naotroco', authorId, args, platform: 'telegram' });
  }

  test("marks a single card non-tradable by ID", async () => {
    await NaoTrocoCommand.execute(ctxFor([String(cardAId)]), { cardsRaw: String(cardAId) });
    expect(await CardsDB.isCardTradable(userId, cardAId)).toBe(false);
  });

  test("a not-owned card by ID replies without throwing", async () => {
    await NaoTrocoCommand.execute(ctxFor([String(unownedCardId)]), { cardsRaw: String(unownedCardId) });
  });

  test("no args shows the non-tradable-cards list instead of the usage message", async () => {
    const startIndex = sentMessages.length;
    await NaoTrocoCommand.execute(ctxFor([]), {});
    await waitForSentMessage(startIndex + 1);

    const msg = sentMessages[sentMessages.length - 1]!;
    const content = msg.text ?? msg.content ?? "";
    expect(content).toContain("Lista de não trocáveis");
    expect(content).not.toContain("Uso:");
  });

  test("the list includes a card just marked non-tradable and excludes one still tradable", async () => {
    const page = await renderPage(`:${userId}`, 0);
    expect(page?.content).toContain('Test NaoTroco Card A');
    expect(page?.content).not.toContain('Test NaoTroco Card B');
  });
});

describe("/naotroco with no non-tradable cards", () => {
  const fx = new TestFixtures();
  const authorId = `test-naotroco-list-empty-${Date.now()}`;
  let userId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test NaoTroco List Empty", platform: 'telegram', platformId: authorId })).id;
  });

  afterAll(() => fx.cleanup());

  test("shows the empty-state message, no pagination", async () => {
    const page = await renderPage(`:${userId}`, 0);
    expect(page?.content).toContain('_Nenhum card encontrado._');
    expect(page?.content).toContain('`0` cards na lista.');
    expect(page?.hasNext).toBe(false);
    expect(page?.totalPages).toBe(1);
  });

  test("execute() with no args doesn't throw", async () => {
    await import("@girae/answerer/index");
    const ctx = fakeCtx({ name: 'naotroco', authorId, platform: 'telegram' });
    await expect(NaoTrocoCommand.execute(ctx, {})).resolves.toBeUndefined();
  });
});
