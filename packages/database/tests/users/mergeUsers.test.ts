import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { db } from "../../index";
import { users, userProfiles, linkedAccounts } from "../../schemas/users";
import { cards, rarities, userCards, wishlist } from "../../schemas/cards";
import { storeItems, boughtItems } from "../../schemas/vanities";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";

describe("UsersDB.mergeUsers", () => {
  let mainId: number, secondaryId: number;
  let rarityId: number;
  let cardAId: number, cardBId: number;
  let itemId: number;

  beforeEach(async () => {
    const [rarity] = await db.select().from(rarities).limit(1);
    rarityId = rarity!.id;

    const [main] = await db.insert(users).values({ displayName: "Main", avatarUrl: "", coins: 100 }).returning();
    const [secondary] = await db.insert(users).values({ displayName: "Secondary", avatarUrl: "", coins: 50 }).returning();
    mainId = main!.id;
    secondaryId = secondary!.id;

    await db.insert(userProfiles).values([{ userId: mainId, reputation: 10 }, { userId: secondaryId, reputation: 5 }]);
    await db.insert(linkedAccounts).values([
      { userId: mainId, platform: 'telegram', platformId: `merge-main-${Date.now()}` },
      { userId: secondaryId, platform: 'discord', platformId: `merge-secondary-${Date.now()}` },
    ]);

    const [a, b] = await db.insert(cards).values([
      { name: "Merge Card A", rarityId },
      { name: "Merge Card B", rarityId },
    ]).returning();
    cardAId = a!.id;
    cardBId = b!.id;

    const [item] = await db.insert(storeItems).values({
      title: `Merge Item ${Date.now()}`, description: "t", type: "background", price: 0, itemURL: "https://example.com/x.png",
    }).returning();
    itemId = item!.id;
  });

  afterEach(async () => {
    await db.delete(userCards).where(eq(userCards.userId, mainId));
    await db.delete(wishlist).where(eq(wishlist.userId, mainId));
    await db.delete(boughtItems).where(eq(boughtItems.userId, mainId));
    await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, mainId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, mainId));
    await db.delete(users).where(eq(users.id, mainId));
    await db.delete(storeItems).where(eq(storeItems.id, itemId));
    await db.delete(cards).where(eq(cards.id, cardAId));
    await db.delete(cards).where(eq(cards.id, cardBId));
    // secondary user row should be gone already after a successful merge; delete defensively for failed-test cleanup
    await db.delete(userCards).where(eq(userCards.userId, secondaryId));
    await db.delete(wishlist).where(eq(wishlist.userId, secondaryId));
    await db.delete(boughtItems).where(eq(boughtItems.userId, secondaryId));
    await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, secondaryId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, secondaryId));
    await db.delete(users).where(eq(users.id, secondaryId));
  });

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
    expect(links.map(l => l.platform).sort()).toEqual(['discord', 'telegram']);

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
    const [partner] = await db.insert(users).values({ displayName: "Partner", avatarUrl: "" }).returning();
    await db.insert(userProfiles).values({ userId: partner!.id, isMarried: true, partnerId: secondaryId });
    await db.update(userProfiles).set({ isMarried: true, partnerId: partner!.id }).where(eq(userProfiles.userId, secondaryId));

    await UsersDB.mergeUsers(mainId, secondaryId);

    const [partnerProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, partner!.id));
    expect(partnerProfile!.isMarried).toBe(false);
    expect(partnerProfile!.partnerId).toBeNull();

    const [mainProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, mainId));
    expect(mainProfile!.isMarried).toBe(false);

    await db.delete(userProfiles).where(eq(userProfiles.userId, partner!.id));
    await db.delete(users).where(eq(users.id, partner!.id));
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
