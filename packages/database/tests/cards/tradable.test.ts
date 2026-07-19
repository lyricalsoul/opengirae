import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, rarities, userCards } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";
import { UsersDB } from "../../users";

describe("tradable flag: default preference + explicit override", () => {
  let userId: number;
  let rarityId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({
      displayName: "Test Tradable", avatarUrl: "",
    }).returning();
    userId = user!.id;

    const [a, b] = await db.insert(cards).values([
      { name: "Test Tradable Card A", rarityId },
      { name: "Test Tradable Card B", rarityId },
    ]).returning();
    cardAId = a!.id;
    cardBId = b!.id;
  });

  afterAll(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cards).where(inArray(cards.id, [cardAId, cardBId]));
    await db.delete(users).where(eq(users.id, userId));
  });

  beforeEach(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.update(users).set({ makeCardsTradeableByDefault: false }).where(eq(users.id, userId));
  });

  test("addUserCard sets tradable=false on first acquisition when the user's default is off", async () => {
    const row = await CardsDB.addUserCard(userId, cardAId);
    expect(row!.tradable).toBe(false);
    expect(await CardsDB.isCardTradable(userId, cardAId)).toBe(false);
  });

  test("addUserCard sets tradable=true on first acquisition when the user's default is on", async () => {
    await UsersDB.setMakeCardsTradeableByDefault(userId, true);
    const row = await CardsDB.addUserCard(userId, cardAId);
    expect(row!.tradable).toBe(true);
  });

  test("addUserCard does not touch tradable on a repeat acquisition", async () => {
    await CardsDB.addUserCard(userId, cardAId);
    await CardsDB.setCardTradable(userId, cardAId, true);

    await UsersDB.setMakeCardsTradeableByDefault(userId, false);
    const row = await CardsDB.addUserCard(userId, cardAId);
    expect(row!.count).toBe(2);
    expect(row!.tradable).toBe(true);
  });

  test("setCardTradable explicitly overrides the flag either direction", async () => {
    await CardsDB.addUserCard(userId, cardBId);
    expect(await CardsDB.isCardTradable(userId, cardBId)).toBe(false);

    await CardsDB.setCardTradable(userId, cardBId, true);
    expect(await CardsDB.isCardTradable(userId, cardBId)).toBe(true);

    await CardsDB.setCardTradable(userId, cardBId, false);
    expect(await CardsDB.isCardTradable(userId, cardBId)).toBe(false);
  });

  test("isCardTradable is false for a card the user doesn't own", async () => {
    expect(await CardsDB.isCardTradable(userId, cardAId)).toBe(false);
  });
});
