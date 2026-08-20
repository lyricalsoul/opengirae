import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import TrocoCommand from "../../commands/cards/troco";

mockTelegram();

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
});
