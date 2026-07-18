import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, rarities, userCards, wishlist } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.compareWishlists", () => {
  let userAId: number, userBId: number;
  let rarityId: number;
  let cardWantedByBId: number, cardWantedByAId: number, cardNotTradableId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [a, b] = await db.insert(users).values([
      { telegramId: `test-compare-a-${Date.now()}`, displayName: "Test Compare A", avatarUrl: "" },
      { telegramId: `test-compare-b-${Date.now()}`, displayName: "Test Compare B", avatarUrl: "" },
    ]).returning();
    userAId = a!.id;
    userBId = b!.id;

    const [c1, c2, c3] = await db.insert(cards).values([
      { name: "Test Compare Card wanted-by-B", rarityId },
      { name: "Test Compare Card wanted-by-A", rarityId },
      { name: "Test Compare Card not-tradable", rarityId },
    ]).returning();
    cardWantedByBId = c1!.id;
    cardWantedByAId = c2!.id;
    cardNotTradableId = c3!.id;
  });

  afterAll(async () => {
    await db.delete(wishlist).where(inArray(wishlist.userId, [userAId, userBId]));
    await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId]));
    await db.delete(cards).where(inArray(cards.id, [cardWantedByBId, cardWantedByAId, cardNotTradableId]));
    await db.delete(users).where(inArray(users.id, [userAId, userBId]));
  });

  beforeEach(async () => {
    await db.delete(wishlist).where(inArray(wishlist.userId, [userAId, userBId]));
    await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId]));
  });

  test("shows cards A has that B wants, and cards B has that A wants", async () => {
    // A owns cardWantedByBId (tradable), B wants it
    await CardsDB.addUserCard(userAId, cardWantedByBId);
    await CardsDB.setCardTradable(userAId, cardWantedByBId, true);
    await CardsDB.addToWishlist(userBId, cardWantedByBId);

    // B owns cardWantedByAId (tradable), A wants it
    await CardsDB.addUserCard(userBId, cardWantedByAId);
    await CardsDB.setCardTradable(userBId, cardWantedByAId, true);
    await CardsDB.addToWishlist(userAId, cardWantedByAId);

    const result = await CardsDB.compareWishlists(userAId, userBId);
    expect(result.iHaveTheyWant.map(c => c.id)).toEqual([cardWantedByBId]);
    expect(result.theyHaveIWant.map(c => c.id)).toEqual([cardWantedByAId]);
  });

  test("a non-tradable card never shows up even if wanted", async () => {
    await CardsDB.addUserCard(userAId, cardNotTradableId); // tradable defaults to false
    await CardsDB.addToWishlist(userBId, cardNotTradableId);

    const result = await CardsDB.compareWishlists(userAId, userBId);
    expect(result.iHaveTheyWant).toHaveLength(0);
  });

  test("wanting a card you don't own yourself doesn't create a false match", async () => {
    await CardsDB.addToWishlist(userAId, cardWantedByBId);
    await CardsDB.addToWishlist(userBId, cardWantedByBId);

    const result = await CardsDB.compareWishlists(userAId, userBId);
    expect(result.iHaveTheyWant).toHaveLength(0);
    expect(result.theyHaveIWant).toHaveLength(0);
  });
});
