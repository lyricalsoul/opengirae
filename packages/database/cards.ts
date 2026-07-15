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
import { users } from "./schemas/users";
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

  static createSubcategory = maybeTransaction('createSubcategory', async (client, name: string, categoryId: number, imageUrl?: string) => {
    return await client
      .insert(subcategories)
      .values({ name, categoryId, imageUrl })
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
      .where(ilike(cards.name, name))
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

  // changes only the main subcategory, leaving secondary subcategories (tags) untouched
  static setCardMainSubcategory = maybeTransaction('setCardMainSubcategory', async (client, cardId: number, subcategoryId: number) => {
    await client.delete(cardSubcategories).where(and(eq(cardSubcategories.cardId, cardId), eq(cardSubcategories.isMain, true)));
    await client.insert(cardSubcategories)
      .values({ cardId, subcategoryId, isMain: true })
      .onConflictDoUpdate({ target: [cardSubcategories.cardId, cardSubcategories.subcategoryId], set: { isMain: true } });
  })

  static deleteCard = maybeTransaction('deleteCard', async (client, cardId: number) => {
    await client.delete(cardSubcategories).where(eq(cardSubcategories.cardId, cardId));
    await client.delete(cards).where(eq(cards.id, cardId));
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

  static deleteSubcategory = maybeTransaction('deleteSubcategory', async (client, id: number) => {
    const cardCount = await client
      .select({ cardCount: sql<number>`CAST(COUNT(${cardSubcategories.cardId}) AS INTEGER)` })
      .from(cardSubcategories)
      .where(eq(cardSubcategories.subcategoryId, id))
      .then(rows => rows[0]?.cardCount ?? 0);
    if (cardCount > 0) return { ok: false as const, reason: 'has_cards' as const };

    const drawCount = await client
      .select({ drawCount: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(cardDrawHistory)
      .where(eq(cardDrawHistory.subcategoryId, id))
      .then(rows => rows[0]?.drawCount ?? 0);
    if (drawCount > 0) return { ok: false as const, reason: 'has_history' as const };

    await client.delete(subcategories).where(eq(subcategories.id, id));
    return { ok: true as const };
  })

  static listCardsForAdmin = maybeTransaction('listCardsForAdmin', async (client, opts: {
    limit?: number; offset?: number; query?: string; sortField?: 'name' | 'rarityModifier'; sortDir?: 'asc' | 'desc';
  } = {}) => {
    const { limit = 20, offset = 0, query, sortField, sortDir } = opts;
    const where = query ? ilike(cards.name, `%${query}%`) : undefined;

    const sortColumns = { name: cards.name, rarityModifier: cards.rarityModifier };
    const column = sortField ? sortColumns[sortField] : cards.id;
    const direction = sortField ? (sortDir ?? 'asc') : 'asc';
    const orderBy = direction === 'desc' ? desc(column) : column;

    const [rows, total] = await Promise.all([
      client
        .select({
          id: cards.id,
          name: cards.name,
          imageUrl: cards.imageUrl,
          rarityModifier: cards.rarityModifier,
          rarityName: rarities.name,
          rarityEmoji: rarities.emoji,
          categoryName: categories.name,
          subcategoryName: subcategories.name,
          ownerCount: sql<number>`CAST(COUNT(DISTINCT ${userCards.userId}) AS INTEGER)`,
          totalCopies: sql<number>`CAST(COALESCE(SUM(${userCards.count}), 0) AS INTEGER)`,
        })
        .from(cards)
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .leftJoin(categories, eq(categories.id, subcategories.categoryId))
        .leftJoin(userCards, eq(userCards.cardId, cards.id))
        .where(where)
        .groupBy(cards.id, rarities.id, categories.id, subcategories.id)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      client.select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` }).from(cards).where(where).then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total };
  })

  static listSubcategoriesForAdmin = maybeTransaction('listSubcategoriesForAdmin', async (client, opts: {
    limit?: number; offset?: number; query?: string; categoryId?: number;
    sortField?: 'name' | 'rarityModifier'; sortDir?: 'asc' | 'desc';
  } = {}) => {
    const { limit = 20, offset = 0, query, categoryId, sortField, sortDir } = opts;
    const conditions = [
      query ? ilike(subcategories.name, `%${query}%`) : undefined,
      categoryId ? eq(subcategories.categoryId, categoryId) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumns = { name: subcategories.name, rarityModifier: subcategories.rarityModifier };
    const column = sortField ? sortColumns[sortField] : subcategories.id;
    const direction = sortField ? (sortDir ?? 'asc') : 'asc';
    const orderBy = direction === 'desc' ? desc(column) : column;

    const [rows, total] = await Promise.all([
      client
        .select({
          id: subcategories.id,
          name: subcategories.name,
          categoryId: subcategories.categoryId,
          categoryName: categories.name,
          tags: subcategories.tags,
          isSecondary: subcategories.isSecondary,
          imageUrl: subcategories.imageUrl,
          rarityModifier: subcategories.rarityModifier,
          cardCount: sql<number>`CAST(COUNT(${cardSubcategories.cardId}) AS INTEGER)`,
        })
        .from(subcategories)
        .innerJoin(categories, eq(categories.id, subcategories.categoryId))
        .leftJoin(cardSubcategories, and(eq(cardSubcategories.subcategoryId, subcategories.id), eq(cardSubcategories.isMain, true)))
        .where(where)
        .groupBy(subcategories.id, categories.id)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      client.select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` }).from(subcategories).where(where).then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total };
  })

  static getCardForAdminEdit = maybeTransaction('getCardForAdminEdit', async (client, id: number) => {
    const card = await client
      .select({
        id: cards.id,
        name: cards.name,
        imageUrl: cards.imageUrl,
        rarityId: cards.rarityId,
        rarityModifier: cards.rarityModifier,
        categoryId: subcategories.categoryId,
        subcategoryId: subcategories.id,
      })
      .from(cards)
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .where(eq(cards.id, id))
      .limit(1)
      .then(a => a?.[0]);
    if (!card) return undefined;

    const secondarySubcategoryIds = await client
      .select({ subcategoryId: cardSubcategories.subcategoryId })
      .from(cardSubcategories)
      .where(and(eq(cardSubcategories.cardId, id), eq(cardSubcategories.isMain, false)))
      .then(rows => rows.map(r => r.subcategoryId));

    return { ...card, secondarySubcategoryIds };
  })

  static deleteCardGuarded = maybeTransaction('deleteCardGuarded', async (client, id: number) => {
    const ownerCount = await client
      .select({ ownerCount: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(userCards)
      .where(eq(userCards.cardId, id))
      .then(rows => rows[0]?.ownerCount ?? 0);
    if (ownerCount > 0) return { ok: false as const, reason: 'has_owners' as const, ownerCount };

    const drawCount = await client
      .select({ drawCount: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(cardDrawHistory)
      .where(eq(cardDrawHistory.cardId, id))
      .then(rows => rows[0]?.drawCount ?? 0);
    if (drawCount > 0) return { ok: false as const, reason: 'has_history' as const };

    await client.delete(cardSubcategories).where(eq(cardSubcategories.cardId, id));
    await client.delete(cards).where(eq(cards.id, id));
    return { ok: true as const };
  })

  static forceDeleteCard = maybeTransaction('forceDeleteCard', async (client, id: number) => {
    await client.delete(cardDrawHistory).where(eq(cardDrawHistory.cardId, id));
    await client.delete(userCards).where(eq(userCards.cardId, id));
    await client.delete(cardSubcategories).where(eq(cardSubcategories.cardId, id));
    await client.update(users).set({ favoriteCardId: null }).where(eq(users.favoriteCardId, id));
    await client.delete(cards).where(eq(cards.id, id));
  })
}
