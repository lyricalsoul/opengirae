import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users, userProfiles } from "../../schemas/users";
import { userCards } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { RankDB } from "../../rank";

describe("RankDB", () => {
  const fx = new TestFixtures();
  let highId: number, lowId: number, highPlatformId: string, cardId: number, catHighId: number, catLowId: number;

  beforeAll(async () => {
    highPlatformId = `test-rank-high-${Date.now()}`;
    const high = await fx.user({ displayName: "Test Rank High", platform: "telegram", platformId: highPlatformId });
    const low = await fx.user({ displayName: "Test Rank Low", platform: "telegram", platformId: `test-rank-low-${Date.now()}` });
    highId = high.id;
    lowId = low.id;

    await db.update(users).set({ coins: 999999999 }).where(eq(users.id, highId));
    await db.update(users).set({ coins: 0 }).where(eq(users.id, lowId));
    await db.update(userProfiles).set({ reputation: 999999999 }).where(eq(userProfiles.userId, highId));
    await db.update(userProfiles).set({ reputation: 0 }).where(eq(userProfiles.userId, lowId));

    const categoryId = (await fx.category({ name: `Test Rank Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test Rank Sub ${Date.now()}` })).id;
    cardId = (await fx.card({ name: `Test Rank Card ${Date.now()}`, subcategoryId })).id;
    await db.insert(userCards).values({ userId: highId, cardId, count: 999999 });
    fx.onCleanup(async () => {
      await db.delete(userCards).where(eq(userCards.userId, highId));
    });

    // dedicated users below, so these fixtures don't skew the exact card-count/reputation assertions above.
    catHighId = (await fx.user({ displayName: "Test Rank Cativeiro High", platform: "telegram", platformId: `test-rank-cativeiro-high-${Date.now()}` })).id;
    catLowId = (await fx.user({ displayName: "Test Rank Cativeiro Low", platform: "telegram", platformId: `test-rank-cativeiro-low-${Date.now()}` })).id;
    const lowThresholdRarityId = (await fx.rarity({ name: `Test Rank Cativeiro Rarity ${Date.now()}`, cativeiroThreshold: 2 })).id;
    const cativeiroCards = await Promise.all([1, 2, 3].map(n => fx.card({ name: `Test Rank Cativeiro Card ${n} ${Date.now()}`, subcategoryId, rarityId: lowThresholdRarityId })));
    // catHighId clears the threshold (2) on all 3 cards; catLowId owns one card but stays under threshold
    await db.insert(userCards).values(cativeiroCards.map(c => ({ userId: catHighId, cardId: c.id, count: 2 })));
    await db.insert(userCards).values({ userId: catLowId, cardId: cativeiroCards[0]!.id, count: 1 });
    fx.onCleanup(async () => {
      await db.delete(userCards).where(inArray(userCards.cardId, cativeiroCards.map(c => c.id)));
    });
  });

  afterAll(() => fx.cleanup());

  test("getTopByReputation puts the extreme-value user first and reports platformId/total", async () => {
    const [top] = await RankDB.getTopByReputation("telegram", 1, 0);
    expect(top?.userId).toBe(highId);
    expect(top?.platformId).toBe(highPlatformId);
    expect(top?.value).toBe(999999999);
    expect(top!.total).toBeGreaterThan(1);
  });

  test("getTopByCoins puts the extreme-value user first", async () => {
    const [top] = await RankDB.getTopByCoins("telegram", 1, 0);
    expect(top?.userId).toBe(highId);
    expect(top?.value).toBe(999999999);
  });

  test("getTopByCardCount puts the extreme-value user first", async () => {
    const [top] = await RankDB.getTopByCardCount("telegram", 1, 0);
    expect(top?.userId).toBe(highId);
    expect(top?.value).toBe(999999);
  });

  test("getTopByCativeiro surfaces the exact (user, card) row", async () => {
    const [top] = await RankDB.getTopByCativeiro("telegram", 1, 0);
    expect(top?.userId).toBe(highId);
    expect(top?.cardId).toBe(cardId);
    expect(top?.count).toBe(999999);
  });

  test("position methods rank the extreme-value user above the zero-value user", async () => {
    const highRepPos = await RankDB.getReputationPosition(highId);
    const lowRepPos = await RankDB.getReputationPosition(lowId);
    expect(highRepPos!.rank).toBeLessThan(lowRepPos!.rank);

    const highCoinsPos = await RankDB.getCoinsPosition(highId);
    const lowCoinsPos = await RankDB.getCoinsPosition(lowId);
    expect(highCoinsPos!.rank).toBeLessThan(lowCoinsPos!.rank);

    const highCardsPos = await RankDB.getCardCountPosition(highId);
    const lowCardsPos = await RankDB.getCardCountPosition(lowId);
    expect(highCardsPos!.rank).toBeLessThan(lowCardsPos!.rank);
  });

  test("getCativeiroPosition returns undefined for a user who owns no cards", async () => {
    expect(await RankDB.getCativeiroPosition(lowId)).toBeUndefined();
  });

  test("getTopByCativeiroCount counts distinct cards past cativeiroThreshold, not raw card count", async () => {
    const [top] = await RankDB.getTopByCativeiroCount("telegram", 1, 0);
    expect(top?.userId).toBe(catHighId);
    expect(top?.value).toBe(3);
  });

  test("getCativeiroCountPosition is undefined for a user with zero cards past threshold", async () => {
    // catLowId owns 1 copy of a card whose threshold is 2 - short of eligible, so no row at all
    expect(await RankDB.getCativeiroCountPosition(catLowId)).toBeUndefined();
  });

  test("a merged account (multiple linked_accounts on the same platform) contributes only one row", async () => {
    const extraPlatformId = `test-rank-high-extra-${Date.now()}`;
    await fx.user({ displayName: "irrelevant, merges into highId", platform: "telegram", platformId: extraPlatformId });
    const { linkedAccounts } = await import("../../schemas/users");
    await db.update(linkedAccounts).set({ userId: highId }).where(eq(linkedAccounts.platformId, extraPlatformId));

    const results = await RankDB.getTopByReputation("telegram", 10, 0);
    const matches = results.filter(r => r.userId === highId);
    expect(matches.length).toBe(1);
  });
});
