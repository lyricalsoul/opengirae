import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TestFixtures, anyRarityId } from "@girae/tests";
import { db } from "../../index";
import { users, userProfiles, linkedAccounts } from "../../schemas/users";
import { userCards, wishlist } from "../../schemas/cards";
import { boughtItems } from "../../schemas/vanities";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";

describe("UsersDB.mergeUsers", () => {
  // a fresh TestFixtures per test (not one shared across the whole describe) since
  // mergeUsers mutates/deletes its own fixtures - each test needs a clean pair.
  let fx: TestFixtures;
  let mainId: number, secondaryId: number;
  let cardAId: number, cardBId: number;
  let itemId: number;

  beforeEach(async () => {
    fx = new TestFixtures();
    const rarityId = await anyRarityId();

    mainId = (await fx.user({ displayName: "Main" })).id;
    secondaryId = (await fx.user({ displayName: "Secondary", platform: 'discord' })).id;
    await db.update(users).set({ coins: 100 }).where(eq(users.id, mainId));
    await db.update(users).set({ coins: 50 }).where(eq(users.id, secondaryId));
    await db.update(userProfiles).set({ reputation: 10 }).where(eq(userProfiles.userId, mainId));
    await db.update(userProfiles).set({ reputation: 5 }).where(eq(userProfiles.userId, secondaryId));

    cardAId = (await fx.card({ name: "Merge Card A", rarityId })).id;
    cardBId = (await fx.card({ name: "Merge Card B", rarityId })).id;
    itemId = (await fx.storeItem({ title: `Merge Item ${Date.now()}`, type: 'background', price: 0 })).id;

    fx.onCleanup(async () => {
      // secondary's row is normally gone already after a successful merge - deletes
      // below are no-ops in that case, and a defensive cleanup if a test throws first.
      await db.delete(userCards).where(eq(userCards.userId, mainId));
      await db.delete(wishlist).where(eq(wishlist.userId, mainId));
      await db.delete(boughtItems).where(eq(boughtItems.userId, mainId));
      await db.delete(userCards).where(eq(userCards.userId, secondaryId));
      await db.delete(wishlist).where(eq(wishlist.userId, secondaryId));
      await db.delete(boughtItems).where(eq(boughtItems.userId, secondaryId));
    });
  });

  afterEach(() => fx.cleanup());

  test("sums coins and reputation into main", async () => {
    await UsersDB.mergeUsers(mainId, secondaryId);
    const [mainUser] = await db.select().from(users).where(eq(users.id, mainId));
    const [mainProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, mainId));
    expect(mainUser!.coins).toBe(150);
    expect(mainProfile!.reputation).toBe(15);
  });

  test("reassigns linked_accounts to main and deletes secondary user row", async () => {
    await UsersDB.mergeUsers(mainId, secondaryId);
    const links = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, mainId));
    expect(links.map(l => l.platform).sort()).toEqual(['discord', 'none']);

    const secondaryRow = await db.select().from(users).where(eq(users.id, secondaryId));
    expect(secondaryRow).toHaveLength(0);
  });

  test("sums user_cards counts on conflict, moves non-conflicting cards", async () => {
    await db.insert(userCards).values([
      { userId: mainId, cardId: cardAId, count: 2 },
      { userId: secondaryId, cardId: cardAId, count: 3 },
      { userId: secondaryId, cardId: cardBId, count: 1 },
    ]);

    await UsersDB.mergeUsers(mainId, secondaryId);

    const mainCards = await db.select().from(userCards).where(eq(userCards.userId, mainId));
    const cardA = mainCards.find(c => c.cardId === cardAId);
    const cardB = mainCards.find(c => c.cardId === cardBId);
    expect(cardA!.count).toBe(5);
    expect(cardB!.count).toBe(1);
  });

  test("skips duplicate wishlist and bought_items entries", async () => {
    await db.insert(wishlist).values([
      { userId: mainId, cardId: cardAId },
      { userId: secondaryId, cardId: cardAId },
      { userId: secondaryId, cardId: cardBId },
    ]);
    await db.insert(boughtItems).values([{ userId: secondaryId, itemId }]);

    await UsersDB.mergeUsers(mainId, secondaryId);

    const mainWishlist = await db.select().from(wishlist).where(eq(wishlist.userId, mainId));
    expect(mainWishlist.map(w => w.cardId).sort()).toEqual([cardAId, cardBId].sort());

    const mainBought = await db.select().from(boughtItems).where(eq(boughtItems.userId, mainId));
    expect(mainBought).toHaveLength(1);
  });

  test("dissolves marriage if secondary was married", async () => {
    const partnerId = (await fx.user({ displayName: "Partner" })).id;
    await db.update(userProfiles).set({ isMarried: true, partnerId: secondaryId }).where(eq(userProfiles.userId, partnerId));
    await db.update(userProfiles).set({ isMarried: true, partnerId }).where(eq(userProfiles.userId, secondaryId));

    await UsersDB.mergeUsers(mainId, secondaryId);

    const [partnerProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, partnerId));
    expect(partnerProfile!.isMarried).toBe(false);
    expect(partnerProfile!.partnerId).toBeNull();

    const [mainProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, mainId));
    expect(mainProfile!.isMarried).toBe(false);
  });

  test("dissolves marriage if main and secondary were married to each other", async () => {
    await db.update(userProfiles).set({ isMarried: true, partnerId: secondaryId }).where(eq(userProfiles.userId, mainId));
    await db.update(userProfiles).set({ isMarried: true, partnerId: mainId }).where(eq(userProfiles.userId, secondaryId));

    await UsersDB.mergeUsers(mainId, secondaryId);

    const [mainProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, mainId));
    expect(mainProfile!.isMarried).toBe(false);
    expect(mainProfile!.partnerId).toBeNull();
  });
});
