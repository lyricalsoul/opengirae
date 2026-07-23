import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards, wishlist } from "../../schemas/cards";
import { inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.compareWishlists", () => {
  const fx = new TestFixtures();
  let userAId: number, userBId: number;
  let cardWantedByBId: number, cardWantedByAId: number, cardNotTradableId: number;

  beforeAll(async () => {
    userAId = (await fx.user({ displayName: "Test Compare A" })).id;
    userBId = (await fx.user({ displayName: "Test Compare B" })).id;

    cardWantedByBId = (await fx.card({ name: "Test Compare Card wanted-by-B" })).id;
    cardWantedByAId = (await fx.card({ name: "Test Compare Card wanted-by-A" })).id;
    cardNotTradableId = (await fx.card({ name: "Test Compare Card not-tradable" })).id;

    // safety net: the last test leaves wishlist/userCards rows behind (beforeEach only
    // clears *before* each test) - this must run before fx.cleanup() deletes the cards/users.
    fx.onCleanup(async () => {
      await db.delete(wishlist).where(inArray(wishlist.userId, [userAId, userBId]));
      await db.delete(userCards).where(inArray(userCards.userId, [userAId, userBId]));
    });
  });

  afterAll(() => fx.cleanup());

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
