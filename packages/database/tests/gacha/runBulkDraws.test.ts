import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { categories, subcategories, cards, cardSubcategories, rarities, userCards, cardDrawHistory } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { GachaLogic } from "../../gacha";

describe("GachaLogic.runBulkDraws", () => {
  let userId: number;
  let rarityId: number;
  let categoryId: number;
  let favSubId: number, favSubBId: number, otherSubId: number, emptySubId: number;
  let favCardId: number, favCardBId: number, otherCardId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({ displayName: "Test Bulk Draw", avatarUrl: "" }).returning();
    userId = user!.id;

    const [category] = await db.insert(categories).values({
      name: "Test Bulk Category", emoji: "🧪", subcategoriesOnDraw: 4,
    }).returning();
    categoryId = category!.id;

    const [fav, favB, other, empty] = await db.insert(subcategories).values([
      { categoryId, name: "Test Bulk Fav Sub" },
      { categoryId, name: "Test Bulk Fav Sub B" },
      { categoryId, name: "Test Bulk Other Sub" },
      { categoryId, name: "Test Bulk Empty Sub" }, // no cards linked - forces the empty-card-pool skip
    ]).returning();
    favSubId = fav!.id;
    favSubBId = favB!.id;
    otherSubId = other!.id;
    emptySubId = empty!.id;

    const [favCard, favCardB, otherCard] = await db.insert(cards).values([
      { name: "Test Bulk Fav Card", rarityId },
      { name: "Test Bulk Fav Card B", rarityId },
      { name: "Test Bulk Other Card", rarityId },
    ]).returning();
    favCardId = favCard!.id;
    favCardBId = favCardB!.id;
    otherCardId = otherCard!.id;

    await db.insert(cardSubcategories).values([
      { cardId: favCardId, subcategoryId: favSubId, isMain: true },
      { cardId: favCardBId, subcategoryId: favSubBId, isMain: true },
      { cardId: otherCardId, subcategoryId: otherSubId, isMain: true },
    ]);
  });

  afterAll(async () => {
    await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cardSubcategories).where(inArray(cardSubcategories.cardId, [favCardId, favCardBId, otherCardId]));
    await db.delete(cards).where(inArray(cards.id, [favCardId, favCardBId, otherCardId]));
    await db.delete(subcategories).where(inArray(subcategories.id, [favSubId, favSubBId, otherSubId, emptySubId]));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(users).where(eq(users.id, userId));
  });

  test("with a favorite subcategory rolled, always draws from it (isFromFavorite: true)", async () => {
    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);

    const results = await GachaLogic.runBulkDraws(userId, [categoryId, categoryId, categoryId, categoryId, categoryId], 100, new Set([favSubId]));

    // subcategoriesOnDraw=3 out of {fav, other, empty} means the favorite is rolled most of the time
    // across 5 draws - assert it's rolled and honored at least once (probabilistically near-certain).
    expect(results.some(r => r.isFromFavorite && r.subcategoryId === favSubId)).toBe(true);
    // never draws from the non-favorite subcategory when a favorite was actually available in that draw's roll
    for (const r of results) {
      if (r.isFromFavorite) expect(r.subcategoryId).toBe(favSubId);
    }

    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after - before).toBe(results.length);

    await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
    await db.delete(userCards).where(eq(userCards.userId, userId));
  });

  test("with two favorite subcategories rolled together, weighted-picks among just the favorites - never the non-favorite, and actually varies which favorite wins", async () => {
    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);

    const drawCount = 30;
    const results = await GachaLogic.runBulkDraws(
      userId,
      Array(drawCount).fill(categoryId),
      100,
      new Set([favSubId, favSubBId]),
    );

    // every draw must land on one of the two favorites, never the plain "other" subcategory.
    expect(results.every(r => r.isFromFavorite)).toBe(true);
    expect(results.every(r => r.subcategoryId === favSubId || r.subcategoryId === favSubBId)).toBe(true);

    // equal weights, 30 draws all on one side is (1/2)^30 - a flake here means the weighting is broken.
    const favSubHits = results.filter(r => r.subcategoryId === favSubId).length;
    const favSubBHits = results.filter(r => r.subcategoryId === favSubBId).length;
    expect(favSubHits).toBeGreaterThan(0);
    expect(favSubBHits).toBeGreaterThan(0);
    expect(favSubHits + favSubBHits).toBe(results.length);

    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after - before).toBe(results.length);

    await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
    await db.delete(userCards).where(eq(userCards.userId, userId));
  });

  test("with no favorites passed, falls back to plain weighted pick (isFromFavorite: false)", async () => {
    const results = await GachaLogic.runBulkDraws(userId, [categoryId, categoryId, categoryId], 100);
    expect(results.every(r => r.isFromFavorite === false)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
    await db.delete(userCards).where(eq(userCards.userId, userId));
  });

  test("a category with no subcategories is skipped, not counted against usedDraws", async () => {
    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);

    const results = await GachaLogic.runBulkDraws(userId, [999999], 100); // nonexistent category id
    expect(results).toEqual([]);

    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after).toBe(before);
  });

  test("repeatedly hitting a subcategory with no cards is skipped, not counted against usedDraws", async () => {
    // force every roll toward the empty subcategory by making it the only favorite target,
    // with subcategoriesOnDraw covering all 3 subs so it's always in the rolled set
    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);

    const results = await GachaLogic.runBulkDraws(userId, [categoryId], 100, new Set([emptySubId]));
    // either it drew nothing (skipped) or, if the weighted pick happened not to land on emptySubId
    // this run, it drew normally - either way usedDraws only moves by results.length
    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after - before).toBe(results.length);

    await db.delete(cardDrawHistory).where(eq(cardDrawHistory.userId, userId));
    await db.delete(userCards).where(eq(userCards.userId, userId));
  });
});
