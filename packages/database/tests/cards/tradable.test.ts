import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { userCards, cardDrawHistory, trades } from "../../schemas/cards";
import { eq, or } from "drizzle-orm";
import { CardsDB } from "../../cards";
import { UsersDB } from "../../users";
import { GachaLogic } from "../../gacha";

describe("tradable flag: default preference + explicit override", () => {
  const fx = new TestFixtures();
  let userId: number;
  let recipientId: number;
  let cardAId: number, cardBId: number;
  let bulkCategoryId: number, bulkCardId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Tradable" })).id;
    recipientId = (await fx.user({ displayName: "Test Tradable Recipient" })).id;
    cardAId = (await fx.card({ name: "Test Tradable Card A" })).id;
    cardBId = (await fx.card({ name: "Test Tradable Card B" })).id;

    bulkCategoryId = (await fx.category({ name: "Test Tradable Bulk Category" })).id;
    const bulkSubId = (await fx.subcategory({ categoryId: bulkCategoryId, name: "Test Tradable Bulk Sub" })).id;
    bulkCardId = (await fx.card({ name: "Test Tradable Bulk Card", subcategoryId: bulkSubId })).id;

    fx.onCleanup(async () => {
      await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
      await db.delete(userCards).where(eq(userCards.userId, userId));
      await db.delete(userCards).where(eq(userCards.userId, recipientId));
      // executeTrade rows must go before the user rows they FK-reference get deleted below.
      await db.delete(trades).where(or(eq(trades.user1Id, userId), eq(trades.user2Id, userId), eq(trades.user1Id, recipientId), eq(trades.user2Id, recipientId)));
    });
  });

  afterAll(() => fx.cleanup());

  beforeEach(async () => {
    await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(userCards).where(eq(userCards.userId, recipientId));
    await db.update(users).set({ makeCardsTradeableByDefault: false }).where(eq(users.id, userId));
    await db.update(users).set({ makeCardsTradeableByDefault: false }).where(eq(users.id, recipientId));
  });

  test("addUserCard sets tradable=false on first acquisition when the user's default is off", async () => {
    const row = await CardsDB.addUserCard(userId, cardAId, 1);
    expect(row!.tradable).toBe(false);
    expect(await CardsDB.isCardTradable(userId, cardAId)).toBe(false);
  });

  test("addUserCard sets tradable=true on first acquisition when the user's default is on", async () => {
    await UsersDB.setMakeCardsTradeableByDefault(userId, true);
    const row = await CardsDB.addUserCard(userId, cardAId, 1);
    expect(row!.tradable).toBe(true);
  });

  test("addUserCard does not touch tradable on a repeat acquisition", async () => {
    await CardsDB.addUserCard(userId, cardAId, 1);
    await CardsDB.setCardTradable(userId, cardAId, true);

    await UsersDB.setMakeCardsTradeableByDefault(userId, false);
    const row = await CardsDB.addUserCard(userId, cardAId, 1);
    expect(row!.count).toBe(2);
    expect(row!.tradable).toBe(true);
  });

  test("setCardTradable explicitly overrides the flag either direction", async () => {
    await CardsDB.addUserCard(userId, cardBId, 1);
    expect(await CardsDB.isCardTradable(userId, cardBId)).toBe(false);

    await CardsDB.setCardTradable(userId, cardBId, true);
    expect(await CardsDB.isCardTradable(userId, cardBId)).toBe(true);

    await CardsDB.setCardTradable(userId, cardBId, false);
    expect(await CardsDB.isCardTradable(userId, cardBId)).toBe(false);
  });

  test("isCardTradable is false for a card the user doesn't own", async () => {
    expect(await CardsDB.isCardTradable(userId, cardAId)).toBe(false);
  });

  // runBulkDraws used to insert userCards rows without a tradable value, ignoring /autotroca.
  test("runBulkDraws sets tradable=true on first acquisition when the user's default is on", async () => {
    await UsersDB.setMakeCardsTradeableByDefault(userId, true);
    await GachaLogic.runBulkDraws(userId, [bulkCategoryId], 100, 1);
    expect(await CardsDB.isCardTradable(userId, bulkCardId)).toBe(true);
  });

  test("runBulkDraws sets tradable=false on first acquisition when the user's default is off", async () => {
    await GachaLogic.runBulkDraws(userId, [bulkCategoryId], 100, 1);
    expect(await CardsDB.isCardTradable(userId, bulkCardId)).toBe(false);
  });

  test("runBulkDraws does not touch tradable on a repeat acquisition", async () => {
    await UsersDB.setMakeCardsTradeableByDefault(userId, true);
    await GachaLogic.runBulkDraws(userId, [bulkCategoryId], 100, 1);
    await CardsDB.setCardTradable(userId, bulkCardId, false);

    await GachaLogic.runBulkDraws(userId, [bulkCategoryId], 100, 1);
    expect(await CardsDB.isCardTradable(userId, bulkCardId)).toBe(false);
  });

  // executeTrade used to insert the recipient's new userCards row without a tradable value,
  // ignoring /autotroca - this is what /doarclc, /trade, etc. all route through.
  test("executeTrade sets tradable=true on the recipient's newly-received card when their default is on", async () => {
    await CardsDB.addUserCard(userId, cardAId, 1);
    await UsersDB.setMakeCardsTradeableByDefault(recipientId, true);

    await CardsDB.executeTrade(userId, [{ cardId: cardAId, count: 1 }], recipientId, [], 1);
    expect(await CardsDB.isCardTradable(recipientId, cardAId)).toBe(true);
  });

  test("executeTrade sets tradable=false on the recipient's newly-received card when their default is off", async () => {
    await CardsDB.addUserCard(userId, cardAId, 1);

    await CardsDB.executeTrade(userId, [{ cardId: cardAId, count: 1 }], recipientId, [], 1);
    expect(await CardsDB.isCardTradable(recipientId, cardAId)).toBe(false);
  });

  test("executeTrade does not touch tradable on a card the recipient already owns", async () => {
    await CardsDB.addUserCard(userId, cardAId, 1);
    await CardsDB.addUserCard(recipientId, cardAId, 1);
    await CardsDB.setCardTradable(recipientId, cardAId, true);
    await UsersDB.setMakeCardsTradeableByDefault(recipientId, false);

    await CardsDB.executeTrade(userId, [{ cardId: cardAId, count: 1 }], recipientId, [], 1);
    expect(await CardsDB.isCardTradable(recipientId, cardAId)).toBe(true);
  });
});
