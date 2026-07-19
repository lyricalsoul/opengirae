import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { cards, userCards, rarities, categories, subcategories, cardSubcategories } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getUserCollectionProgress", () => {
  let userId: number;
  let rarityId: number;
  let categoryId: number;
  let subcategoryId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [user] = await db.insert(users).values({
      displayName: "Test Progress", avatarUrl: "",
    }).returning();
    userId = user!.id;

    const [category] = await db.insert(categories).values({
      name: `Test Progress Category ${Date.now()}`, emoji: "🧪",
    }).returning();
    categoryId = category!.id;

    const [subcategory] = await db.insert(subcategories).values({
      categoryId, name: "Test Progress Subcategory",
    }).returning();
    subcategoryId = subcategory!.id;

    const [a, b] = await db.insert(cards).values([
      { name: "Progress Card A", rarityId },
      { name: "Progress Card B", rarityId },
    ]).returning();
    cardAId = a!.id;
    cardBId = b!.id;

    await db.insert(cardSubcategories).values([
      { cardId: cardAId, subcategoryId, isMain: true },
      { cardId: cardBId, subcategoryId, isMain: true },
    ]);

    // user only owns one of the two cards in this subcategory
    await db.insert(userCards).values({ userId, cardId: cardAId, count: 1 });
  });

  afterAll(async () => {
    await db.delete(userCards).where(eq(userCards.userId, userId));
    await db.delete(cardSubcategories).where(inArray(cardSubcategories.cardId, [cardAId, cardBId]));
    await db.delete(cards).where(inArray(cards.id, [cardAId, cardBId]));
    await db.delete(subcategories).where(eq(subcategories.id, subcategoryId));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(users).where(eq(users.id, userId));
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
    const [otherUser] = await db.insert(users).values({
      displayName: "Other", avatarUrl: "",
    }).returning();

    const result = await CardsDB.getUserCollectionProgress(otherUser!.id, { query: "Test Progress Subcategory" });
    expect(result.rows[0]!.owned).toBe(0);
    expect(result.rows[0]!.total).toBe(2);

    await db.delete(users).where(eq(users.id, otherUser!.id));
  });

  test("sortBy: 'closest' ranks by completion ratio, not absolute cards remaining", async () => {
    // A 1-card subcategory the user hasn't touched has a tiny absolute gap (1) but 0%
    // completion; a 10-card subcategory the user is 9/10 through has a bigger absolute gap (1
    // too, coincidentally) but should still win on ratio. Use sizes where ratio and absolute
    // gap actively disagree: tiny/untouched (gap 1, ratio 0%) vs big/almost-done (gap 5, ratio
    // 83%) - absolute-gap sorting would incorrectly rank tiny first.
    const [tiny] = await db.insert(subcategories).values({
      categoryId, name: `Test Progress Tiny ${Date.now()}`,
    }).returning();
    const [tinyCard] = await db.insert(cards).values({ name: "Tiny Card", rarityId }).returning();
    await db.insert(cardSubcategories).values({ cardId: tinyCard!.id, subcategoryId: tiny!.id, isMain: true });

    const [big] = await db.insert(subcategories).values({
      categoryId, name: `Test Progress Big ${Date.now()}`,
    }).returning();
    const bigCards = await db.insert(cards).values(
      Array.from({ length: 6 }, (_, i) => ({ name: `Big Card ${i}`, rarityId })),
    ).returning();
    await db.insert(cardSubcategories).values(
      bigCards.map(c => ({ cardId: c.id, subcategoryId: big!.id, isMain: true })),
    );
    await db.insert(userCards).values(
      bigCards.slice(0, 5).map(c => ({ userId, cardId: c.id, count: 1 })),
    );

    const result = await CardsDB.getUserCollectionProgress(userId, {
      query: "Test Progress", sortBy: "closest",
    });
    const names = result.rows.map(r => r.subcategoryName);
    expect(names.indexOf(big!.name)).toBeLessThan(names.indexOf(tiny!.name));

    await db.delete(userCards).where(inArray(userCards.cardId, bigCards.map(c => c.id)));
    await db.delete(cardSubcategories).where(inArray(cardSubcategories.cardId, [tinyCard!.id, ...bigCards.map(c => c.id)]));
    await db.delete(cards).where(inArray(cards.id, [tinyCard!.id, ...bigCards.map(c => c.id)]));
    await db.delete(subcategories).where(inArray(subcategories.id, [tiny!.id, big!.id]));
  });
});
