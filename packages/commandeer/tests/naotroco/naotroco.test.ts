import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import NaoTrocoCommand from "../../commands/cards/naotroco";

mockTelegram();

describe("/naotroco marks one or several cards as not tradable", () => {
  const fx = new TestFixtures();
  const authorId = "test-naotroco-author";
  let userId: number;
  let cardAId: number, cardBId: number, cardCId: number, unownedCardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test NaoTroco", platform: 'telegram', platformId: authorId })).id;
    const categoryId = (await fx.category({ name: `Test NaoTroco Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test NaoTroco Sub ${Date.now()}` })).id;

    cardAId = (await fx.card({ name: `Test NaoTroco Card A ${Date.now()}`, subcategoryId })).id;
    cardBId = (await fx.card({ name: `Test NaoTroco Card B ${Date.now()}`, subcategoryId })).id;
    cardCId = (await fx.card({ name: `Test NaoTroco Card C ${Date.now()}`, subcategoryId })).id;
    unownedCardId = (await fx.card({ name: `Test NaoTroco Unowned ${Date.now()}`, subcategoryId })).id;

    await fx.ownCard(userId, cardAId, 1);
    await fx.ownCard(userId, cardBId, 1);
    await fx.ownCard(userId, cardCId, 1);
    await CardsDB.setAllUserCardsTradable(userId, true);
  });

  afterAll(() => fx.cleanup());

  function ctxFor(args: string[]) {
    return fakeCtx({ name: 'naotroco', authorId, args, platform: 'telegram' });
  }

  test("marks a single card not-tradable by ID", async () => {
    await NaoTrocoCommand.execute(ctxFor([String(cardAId)]), { cardsRaw: String(cardAId) });
    expect(await CardsDB.isCardTradable(userId, cardAId)).toBe(false);
  });

  test("a not-owned card by ID replies without throwing", async () => {
    await expect(NaoTrocoCommand.execute(ctxFor([String(unownedCardId)]), { cardsRaw: String(unownedCardId) })).resolves.toBeUndefined();
  });

  test("marks multiple owned cards not-tradable in one command, skipping a not-owned ID", async () => {
    const raw = `${cardBId} ${cardCId} ${unownedCardId}`;
    await NaoTrocoCommand.execute(ctxFor(raw.split(' ')), { cardsRaw: raw });

    expect(await CardsDB.isCardTradable(userId, cardBId)).toBe(false);
    expect(await CardsDB.isCardTradable(userId, cardCId)).toBe(false);
  });
});
