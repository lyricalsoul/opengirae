import { maybeTransaction } from "./decorators";
import {
  cards,
  categories,
  subcategories,
  rarities,
  userCards,
  cardDrawHistory,
  cardSubcategories
} from "./schemas/cards";
import { eq, and, sql, ilike, desc } from "drizzle-orm";

export class CardsDB {
  static getCategory = maybeTransaction('getCategory', async (client, id: number) => {
    return await client
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1)
      .then(a => a?.[0]);
  })

  static getSubcategory = maybeTransaction('getSubcategory', async (client, id: number) => {
    return await client
      .select()
      .from(subcategories)
      .where(eq(subcategories.id, id))
      .limit(1)
      .then(a => a?.[0]);
  })

  static getRarity = maybeTransaction('getRarity', async (client, id: number) => {
    return await client.select().from(rarities).where(eq(rarities.id, id)).limit(1).then(a => a?.[0]);
  })

  static getCard = maybeTransaction('getCard', async (client, id: number) => {
    return await client.select().from(cards).where(eq(cards.id, id)).limit(1).then(a => a?.[0]);
  })

  static getCardWithDetails = maybeTransaction('getCardWithDetails', async (client, id: number) => {
    return await client
      .select({
        id: cards.id,
        name: cards.name,
        imageUrl: cards.imageUrl,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
        categoryEmoji: categories.emoji,
        subcategoryName: subcategories.name,
      })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .leftJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(eq(cards.id, id))
      .limit(1)
      .then(a => a?.[0]);
  })

  static getCardForEdit = maybeTransaction('getCardForEdit', async (client, id: number) => {
    return await client
      .select({
        id: cards.id,
        name: cards.name,
        imageUrl: cards.imageUrl,
        rarityName: rarities.name,
        categoryName: categories.name,
        subcategoryName: subcategories.name,
        subcategoryId: subcategories.id,
      })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .leftJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(eq(cards.id, id))
      .limit(1)
      .then(a => a?.[0]);
  })

  static createCategory = maybeTransaction('createCategory', async (client, name: string, emoji: string = "🏷️") => {
    return await client.insert(categories).values({ name, emoji }).returning().then(a => a?.[0]);
  })

  static createSubcategory = maybeTransaction('createSubcategory', async (client, name: string, categoryId: number) => {
    return await client
      .insert(subcategories)
      .values({ name, categoryId })
      .returning()
      .then(a => a?.[0]);
  })

  static getCategoryByName = maybeTransaction('getCategoryByName', async (client, name: string) => {
    return await client.select().from(categories).where(eq(categories.name, name)).limit(1).then(a => a?.[0]);
  })

  static getRarityByName = maybeTransaction('getRarityByName', async (client, name: string) => {
    return await client.select().from(rarities).where(eq(rarities.name, name)).limit(1).then(a => a?.[0]);
  })

  static getSubcategoryByName = maybeTransaction('getSubcategoryByName', async (client, name: string) => {
    return await client.select().from(subcategories).where(eq(subcategories.name, name)).limit(1).then(a => a?.[0]);
  })

  static getOrCreateCategory = maybeTransaction('getOrCreateCategory', async (client, name: string) => {
    const existing = await client.select().from(categories).where(eq(categories.name, name)).limit(1).then(a => a?.[0]);
    if (existing) return existing;
    return await client.insert(categories).values({ name, emoji: "🏷️" }).returning().then(a => a?.[0]);
  })

  static getOrCreateSubcategory = maybeTransaction('getOrCreateSubcategory', async (client, name: string, categoryId: number) => {
    const existing = await client.select().from(subcategories).where(eq(subcategories.name, name)).limit(1).then(a => a?.[0]);
    if (existing) return existing;
    return await client.insert(subcategories).values({ name, categoryId }).returning().then(a => a?.[0]);
  })

  static getCardByNameAndSubcategory = maybeTransaction('getCardByNameAndSubcategory', async (client, name: string, subcategoryId: number) => {
    return await client
      .select({ id: cards.id, name: cards.name })
      .from(cards)
      .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.subcategoryId, subcategoryId)))
      .where(eq(cards.name, name))
      .limit(1)
      .then(a => a?.[0]);
  })

  static updateCard = maybeTransaction('updateCard', async (client, id: number, data: Partial<typeof cards.$inferInsert>) => {
    return await client.update(cards).set(data).where(eq(cards.id, id)).returning().then(a => a?.[0]);
  })

  static updateCategory = maybeTransaction('updateCategory', async (client, id: number, data: Partial<typeof categories.$inferInsert>) => {
    return await client.update(categories).set(data).where(eq(categories.id, id)).returning().then(a => a?.[0]);
  })

  static updateSubcategory = maybeTransaction('updateSubcategory', async (client, id: number, data: Partial<typeof subcategories.$inferInsert>) => {
    return await client.update(subcategories).set(data).where(eq(subcategories.id, id)).returning().then(a => a?.[0]);
  })

  static setCardSubcategories = maybeTransaction('setCardSubcategories', async (client, cardId: number, mainSubcategoryId: number, secondarySubcategoryIds: number[] = []) => {
    await client.delete(cardSubcategories).where(eq(cardSubcategories.cardId, cardId));
    await client.insert(cardSubcategories).values([
      { cardId, subcategoryId: mainSubcategoryId, isMain: true },
      ...secondarySubcategoryIds.map(subcategoryId => ({ cardId, subcategoryId, isMain: false }))
    ]);
  })

  static createRarity = maybeTransaction('createRarity', async (client, name: string, emoji: string, weight: number) => {
    return await client.insert(rarities).values({ name, emoji, weight }).returning().then(a => a?.[0]);
  })

  static createCard = maybeTransaction('createCard', async (
    client,
    name: string,
    rarityId: number,
    imageUrl: string | null,
    mainSubcategoryId: number,
    secondarySubcategoryIds: number[] = [],
  ) => {
    const card = await client.insert(cards).values({ name, rarityId, imageUrl }).returning().then(a => a?.[0]);
    if (!card) return undefined;

    await client.insert(cardSubcategories).values([
      { cardId: card.id, subcategoryId: mainSubcategoryId, isMain: true },
      ...secondarySubcategoryIds.map(subcategoryId => ({ cardId: card.id, subcategoryId, isMain: false }))
    ]);

    return card;
  })

  static getUserCard = maybeTransaction('getUserCard', async (client, userId: number, cardId: number) => {
    return await client
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1)
      .then((a) => a?.[0]);
  })

  static hasUserCard = maybeTransaction('hasUserCard', async (client, userId: number, cardId: number) => {
    return !!(await client
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1)
      .then((a) => a?.[0]));
  })

  // TODO: would be cleaner as a raw SQL query
  static addUserCard = maybeTransaction('addUserCard', async (client, userId: number, cardId: number) => {
    const existing = await client
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1)
      .then((a) => a?.[0]);

    if (existing) {
      return await client
        .update(userCards)
        .set({ count: sql`${userCards.count} + 1` })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
        .returning()
        .then(a => a?.[0]);
    }

    return await client.insert(userCards).values({ userId, cardId }).returning().then(a => a?.[0]);
  })

  static addCardDrawHistory = maybeTransaction('addCardDrawHistory', async (client, userId: number, cardId: number, categoryId: number, subcategoryId: number) => {
    return await client.insert(cardDrawHistory).values({ userId, cardId, categoryId, subcategoryId }).returning().then(a => a?.[0]);
  })

  static getCategories = maybeTransaction('getCategories', async (client) => {
    return await client
      .select()
      .from(categories)
  })

  static getRarities = maybeTransaction('getRarities', async (client) => {
    return await client.select().from(rarities)
  })

  static getSubcategoriesForCategory = maybeTransaction('getSubcategoriesForCategory', async (client, categoryId: number) => {
    return await client
      .select()
      .from(subcategories)
      .where(eq(subcategories.categoryId, categoryId))
  })

  static searchCardsByName = maybeTransaction('searchCardsByName', async (client, query: string, limit: number = 100) => {
    return await client
      .select({
        id: cards.id,
        name: cards.name,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
        categoryEmoji: categories.emoji,
        subcategoryName: subcategories.name,
      })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .leftJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(ilike(cards.name, `%${query}%`))
      .limit(limit);
  })

  static getCardOwnerCount = maybeTransaction('getCardOwnerCount', async (client, cardId: number): Promise<number> => {
    const result = await client
      .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(userCards)
      .where(eq(userCards.cardId, cardId))
      .then(a => a?.[0]);
    return result?.total ?? 0;
  })

  static getCardTotalCopies = maybeTransaction('getCardTotalCopies', async (client, cardId: number): Promise<number> => {
    const result = await client
      .select({ total: sql<number>`CAST(COALESCE(SUM(${userCards.count}), 0) AS INTEGER)` })
      .from(userCards)
      .where(eq(userCards.cardId, cardId))
      .then(a => a?.[0]);
    return result?.total ?? 0;
  })

  static getSecondarySubcategoryNames = maybeTransaction('getSecondarySubcategoryNames', async (client, cardId: number): Promise<string[]> => {
    const rows = await client
      .select({ name: subcategories.name })
      .from(cardSubcategories)
      .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .where(and(eq(cardSubcategories.cardId, cardId), eq(cardSubcategories.isMain, false)));
    return rows.map(r => r.name);
  })

  static getSubcategoryByNameAndCategory = maybeTransaction('getSubcategoryByNameAndCategory', async (client, name: string, categoryId: number) => {
    return await client
      .select()
      .from(subcategories)
      .where(and(ilike(subcategories.name, name), eq(subcategories.categoryId, categoryId)))
      .limit(1)
      .then(a => a?.[0]);
  })

  static searchSubcategoriesByName = maybeTransaction('searchSubcategoriesByName', async (client, query: string, limit: number = 100) => {
    return await client
      .select({
        id: subcategories.id,
        name: subcategories.name,
        categoryEmoji: categories.emoji,
      })
      .from(subcategories)
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(ilike(subcategories.name, `%${query}%`))
      .limit(limit);
  })

  static getSubcategoriesWithCardCounts = maybeTransaction('getSubcategoriesWithCardCounts', async (client, categoryId: number) => {
    return await client
      .select({
        id: subcategories.id,
        name: subcategories.name,
        cardCount: sql<number>`CAST(COUNT(${cardSubcategories.cardId}) AS INTEGER)`,
      })
      .from(subcategories)
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.subcategoryId, subcategories.id), eq(cardSubcategories.isMain, true)))
      .where(eq(subcategories.categoryId, categoryId))
      .groupBy(subcategories.id, subcategories.name)
      .orderBy(subcategories.id);
  })

  static getCardsInSubcategoryForUser = maybeTransaction('getCardsInSubcategoryForUser', async (client, subcategoryId: number, userId: number) => {
    return await client
      .select({
        id: cards.id,
        name: cards.name,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
        categoryEmoji: categories.emoji,
        ownedCount: sql<number>`CAST(COALESCE(${userCards.count}, 0) AS INTEGER)`,
      })
      .from(cardSubcategories)
      .innerJoin(cards, eq(cards.id, cardSubcategories.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
      .where(and(eq(cardSubcategories.subcategoryId, subcategoryId), eq(cardSubcategories.isMain, true)))
      .orderBy(desc(cards.rarityId), cards.id);
  })

  static getUserCardsCount = maybeTransaction('getUserCardsCount', async (client, userId: number): Promise<number> => {
    const result = await client
      .select({ total: sql<number>`CAST(COALESCE(SUM(${userCards.count}), 0) AS INTEGER)` })
      .from(userCards)
      .where(eq(userCards.userId, userId))
      .then(a => a?.[0]);
    return result?.total ?? 0;
  })
}
