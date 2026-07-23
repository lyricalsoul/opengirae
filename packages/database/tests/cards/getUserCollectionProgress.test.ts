import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards } from "../../schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getUserCollectionProgress", () => {
  const fx = new TestFixtures();
  let userId: number;
  let categoryId: number;
  let subcategoryId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Progress" })).id;
    categoryId = (await fx.category({ name: `Test Progress Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Progress Subcategory" })).id;

    const cardAId = (await fx.card({ name: "Progress Card A", subcategoryId })).id;
    await fx.card({ name: "Progress Card B", subcategoryId });

    // user only owns one of the two cards in this subcategory
    await db.insert(userCards).values({ userId, cardId: cardAId, count: 1 });
  });

  afterAll(async () => {
    // must run before fx.cleanup() deletes cards - later tests register more card
    // fixtures (tiny/big) after this point, so an fx.onCleanup() registered here would
    // run too late in LIFO order relative to those cards' own delete-cleanups.
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await fx.cleanup();
  });

  test("computes owned/total for a subcategory the user partially owns", async () => {
    const result = await CardsDB.getUserCollectionProgress(userId, { query: "Test Progress Subcategory" });
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.subcategoryId).toBe(subcategoryId);
    expect(result.rows[0]!.subcategoryName).toBe("Test Progress Subcategory");
    expect(result.rows[0]!.owned).toBe(1);
    expect(result.rows[0]!.total).toBe(2);
  });

  test("a different user with zero owned cards sees owned: 0", async () => {
    const otherUserId = (await fx.user({ displayName: "Other" })).id;

    const result = await CardsDB.getUserCollectionProgress(otherUserId, { query: "Test Progress Subcategory" });
    expect(result.rows[0]!.owned).toBe(0);
    expect(result.rows[0]!.total).toBe(2);
  });

  test("sortBy: 'closest' ranks by completion ratio, not absolute cards remaining", async () => {
    // A 1-card subcategory the user hasn't touched has a tiny absolute gap (1) but 0%
    // completion; a 10-card subcategory the user is 9/10 through has a bigger absolute gap (1
    // too, coincidentally) but should still win on ratio. Use sizes where ratio and absolute
    // gap actively disagree: tiny/untouched (gap 1, ratio 0%) vs big/almost-done (gap 5, ratio
    // 83%) - absolute-gap sorting would incorrectly rank tiny first.
    const tiny = await fx.subcategory({ categoryId, name: `Test Progress Tiny ${Date.now()}` });
    await fx.card({ name: "Tiny Card", subcategoryId: tiny.id });

    const big = await fx.subcategory({ categoryId, name: `Test Progress Big ${Date.now()}` });
    const bigCardIds: number[] = [];
    for (let i = 0; i < 6; i++) bigCardIds.push((await fx.card({ name: `Big Card ${i}`, subcategoryId: big.id })).id);
    await db.insert(userCards).values(bigCardIds.slice(0, 5).map(cardId => ({ userId, cardId, count: 1 })));

    const result = await CardsDB.getUserCollectionProgress(userId, {
      query: "Test Progress", sortBy: "closest",
    });
    const names = result.rows.map(r => r.subcategoryName);
    expect(names.indexOf(big.name)).toBeLessThan(names.indexOf(tiny.name));
  });

  test("isGoal reflects whether the viewer favorited the subcategory", async () => {
    const before = await CardsDB.getUserCollectionProgress(userId, { query: "Test Progress Subcategory" });
    const row = before.rows.find(r => r.subcategoryId === subcategoryId)!;
    expect(row.isGoal).toBe(false);

    await CardsDB.addToGoals(userId, subcategoryId);
    const after = await CardsDB.getUserCollectionProgress(userId, { query: "Test Progress Subcategory" });
    expect(after.rows.find(r => r.subcategoryId === subcategoryId)!.isGoal).toBe(true);

    await CardsDB.removeFromGoals(userId, subcategoryId);
  });
});
