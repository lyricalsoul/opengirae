import { maybeTransaction } from "./decorators";
import {
  cards,
  categories,
  subcategories,
  rarities,
  userCards,
  cardDrawHistory,
  cardSubcategories,
  chocolateFactoryCorrections,
  trades,
} from "./schemas/cards";
import { users } from "./schemas/users";
import { eq, and, sql, ilike, desc, gte, inArray } from "drizzle-orm";
import { CARD_DISCARD_REWARDS } from "./constants";

export class InsufficientCardError extends Error {
  constructor(public userId: number, public cardId: number) {
    super(`user ${userId} does not have enough copies of card ${cardId}`);
  }
}

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

  static searchCategoriesByName = maybeTransaction('searchCategoriesByName', async (client, query: string, limit: number = 100) => {
    return await client
      .select({ id: categories.id, name: categories.name, emoji: categories.emoji })
      .from(categories)
      .where(ilike(categories.name, `%${query}%`))
      .limit(limit);
  })

  static getRarityByName = maybeTransaction('getRarityByName', async (client, name: string) => {
    return await client.select().from(rarities).where(eq(rarities.name, name)).limit(1).then(a => a?.[0]);
  })

  static getSubcategoryByName = maybeTransaction('getSubcategoryByName', async (client, name: string) => {
    return await client.select().from(subcategories).where(eq(subcategories.name, name)).limit(1).then(a => a?.[0]);
  })

  static getSubcategoryByAlias = maybeTransaction('getSubcategoryByAlias', async (client, alias: string) => {
    const normalized = alias.trim().toLowerCase();
    return await client
      .select()
      .from(subcategories)
      .where(sql`${normalized} = ANY(${subcategories.aliases})`)
      .limit(1)
      .then(a => a?.[0]);
  })

  static addSubcategoryAlias = maybeTransaction('addSubcategoryAlias', async (client, subcategoryId: number, alias: string) => {
    const normalized = alias.trim().toLowerCase();
    return await client
      .update(subcategories)
      .set({
        aliases: sql`CASE WHEN ${normalized} = ANY(coalesce(${subcategories.aliases}, ARRAY[]::text[]))
          THEN coalesce(${subcategories.aliases}, ARRAY[]::text[])
          ELSE array_append(coalesce(${subcategories.aliases}, ARRAY[]::text[]), ${normalized}) END`,
      })
      .where(eq(subcategories.id, subcategoryId))
      .returning()
      .then(a => a?.[0]);
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

  static getCardByName = maybeTransaction('getCardByName', async (client, name: string) => {
    return await client
      .select({ id: cards.id, name: cards.name })
      .from(cards)
      .where(ilike(cards.name, name))
      .orderBy(cards.id)
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

  static getCorrection = maybeTransaction('getCorrection', async (client, targetName: string) => {
    return await client
      .select({ subcategoryId: chocolateFactoryCorrections.subcategoryId, subcategoryName: subcategories.name, categoryId: subcategories.categoryId })
      .from(chocolateFactoryCorrections)
      .innerJoin(subcategories, eq(subcategories.id, chocolateFactoryCorrections.subcategoryId))
      .where(ilike(chocolateFactoryCorrections.targetName, targetName))
      .limit(1)
      .then(a => a?.[0]);
  })

  static upsertCorrection = maybeTransaction('upsertCorrection', async (client, targetName: string, subcategoryId: number) => {
    return await client
      .insert(chocolateFactoryCorrections)
      .values({ targetName, subcategoryId })
      .onConflictDoUpdate({ target: chocolateFactoryCorrections.targetName, set: { subcategoryId } })
      .returning()
      .then(a => a?.[0]);
  })

  static getSubcategoryCardCount = maybeTransaction('getSubcategoryCardCount', async (client, subcategoryId: number) => {
    return await client
      .select({ count: sql<number>`count(*)::int` })
      .from(cardSubcategories)
      .where(eq(cardSubcategories.subcategoryId, subcategoryId))
      .then(a => a?.[0]?.count ?? 0);
  })

  static mergeSubcategory = maybeTransaction('mergeSubcategory', async (client, fromId: number, toId: number) => {
    const rows = await client.select({ cardId: cardSubcategories.cardId, isMain: cardSubcategories.isMain }).from(cardSubcategories).where(eq(cardSubcategories.subcategoryId, fromId));
    for (const row of rows) {
      await client.insert(cardSubcategories).values({ cardId: row.cardId, subcategoryId: toId, isMain: row.isMain })
        .onConflictDoUpdate({ target: [cardSubcategories.cardId, cardSubcategories.subcategoryId], set: { isMain: sql`${cardSubcategories.isMain} OR excluded."isMain"` } });
    }
    await client.delete(cardSubcategories).where(eq(cardSubcategories.subcategoryId, fromId));
    await client.update(cardDrawHistory).set({ subcategoryId: toId }).where(eq(cardDrawHistory.subcategoryId, fromId));
    await client.delete(subcategories).where(eq(subcategories.id, fromId));
    return rows.length;
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

  static executeTrade = maybeTransaction('executeTrade', async (
    client,
    userAId: number, offerA: { cardId: number; count: number }[],
    userBId: number, offerB: { cardId: number; count: number }[],
  ) => {
    if (userAId === userBId) throw new Error('executeTrade: userAId and userBId must differ');
    for (const offer of [offerA, offerB]) {
      const ids = offer.map(o => o.cardId);
      if (new Set(ids).size !== ids.length) throw new Error('executeTrade: an offer must not list the same cardId twice');
      if (offer.some(o => o.count <= 0)) throw new Error('executeTrade: offer counts must be positive');
    }

    const decrement = async (userId: number, cardId: number, count: number) => {
      const [row] = await client
        .update(userCards)
        .set({ count: sql`${userCards.count} - ${count}` })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId), gte(userCards.count, count)))
        .returning();
      if (!row) throw new InsufficientCardError(userId, cardId);
      if (row.count === 0) {
        await client.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      }
    };

    const increment = async (userId: number, cardId: number, count: number) => {
      const existing = await client
        .select()
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
        .limit(1)
        .then(a => a?.[0]);

      if (existing) {
        await client
          .update(userCards)
          .set({ count: sql`${userCards.count} + ${count}` })
          .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      } else {
        await client.insert(userCards).values({ userId, cardId, count });
      }
    };

    for (const { cardId, count } of offerA) await decrement(userAId, cardId, count);
    for (const { cardId, count } of offerB) await decrement(userBId, cardId, count);
    for (const { cardId, count } of offerA) await increment(userBId, cardId, count);
    for (const { cardId, count } of offerB) await increment(userAId, cardId, count);

    return await client
      .insert(trades)
      .values({
        user1Id: userAId,
        user2Id: userBId,
        cardsUser1: offerA.flatMap(o => Array(o.count).fill(o.cardId)),
        cardsUser2: offerB.flatMap(o => Array(o.count).fill(o.cardId)),
      })
      .returning()
      .then(a => a?.[0]);
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
        imageUrl: cards.imageUrl,
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

  static getCardsInSubcategoryForUserPaginated = maybeTransaction('getCardsInSubcategoryForUserPaginated', async (
    client, subcategoryId: number, userId: number,
    opts: { ownedFilter?: 'owned' | 'missing'; limit?: number; offset?: number } = {},
  ) => {
    const { ownedFilter, limit = 20, offset = 0 } = opts;
    const baseWhere = and(eq(cardSubcategories.subcategoryId, subcategoryId), eq(cardSubcategories.isMain, true));
    const ownedCondition = sql`COALESCE(${userCards.count}, 0) > 0`;
    const missingCondition = sql`COALESCE(${userCards.count}, 0) = 0`;
    const where = ownedFilter === 'owned' ? and(baseWhere, ownedCondition)
      : ownedFilter === 'missing' ? and(baseWhere, missingCondition)
      : baseWhere;

    const rows = await client
      .select({
        id: cards.id,
        name: cards.name,
        imageUrl: cards.imageUrl,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
        ownedCount: sql<number>`CAST(COALESCE(${userCards.count}, 0) AS INTEGER)`,
      })
      .from(cardSubcategories)
      .innerJoin(cards, eq(cards.id, cardSubcategories.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
      .where(where)
      .orderBy(desc(cards.rarityId), cards.id)
      .limit(limit)
      .offset(offset);

    const total = await client
      .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(cardSubcategories)
      .innerJoin(cards, eq(cards.id, cardSubcategories.cardId))
      .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
      .where(where)
      .then(r => r[0]?.total ?? 0);

    const countWith = async (extra: ReturnType<typeof sql>) => client
      .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(cardSubcategories)
      .innerJoin(cards, eq(cards.id, cardSubcategories.cardId))
      .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
      .where(and(baseWhere, extra))
      .then(r => r[0]?.total ?? 0);

    const ownedCount = await countWith(ownedCondition);
    const missingCount = await countWith(missingCondition);

    return { rows, total, ownedCount, missingCount };
  })

  static getUserCardsCount = maybeTransaction('getUserCardsCount', async (client, userId: number): Promise<number> => {
    const result = await client
      .select({ total: sql<number>`CAST(COALESCE(SUM(${userCards.count}), 0) AS INTEGER)` })
      .from(userCards)
      .where(eq(userCards.userId, userId))
      .then(a => a?.[0]);
    return result?.total ?? 0;
  })

  static getUserOwnedCards = maybeTransaction('getUserOwnedCards', async (client, userId: number) => {
    return await client
      .select({
        id: cards.id,
        name: cards.name,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
        categoryEmoji: categories.emoji,
        categoryName: categories.name,
        subcategoryName: subcategories.name,
        ownedCount: userCards.count,
      })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .leftJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(eq(userCards.userId, userId))
      .orderBy(desc(cards.rarityId), cards.id);
  })

  static getUserOwnedCardsPaginated = maybeTransaction('getUserOwnedCardsPaginated', async (
    client, userId: number, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const { query, limit = 20, offset = 0 } = opts;
    const where = query
      ? and(eq(userCards.userId, userId), ilike(cards.name, `%${query}%`))
      : eq(userCards.userId, userId);

    const [rows, total] = await Promise.all([
      client
        .select({
          id: cards.id,
          name: cards.name,
          imageUrl: cards.imageUrl,
          rarityName: rarities.name,
          rarityEmoji: rarities.emoji,
          categoryEmoji: categories.emoji,
          categoryName: categories.name,
          subcategoryName: subcategories.name,
          ownedCount: userCards.count,
        })
        .from(userCards)
        .innerJoin(cards, eq(cards.id, userCards.cardId))
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .leftJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(where)
        .orderBy(desc(cards.rarityId), cards.id)
        .limit(limit)
        .offset(offset),
      client
        .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
        .from(userCards)
        .innerJoin(cards, eq(cards.id, userCards.cardId))
        .where(where)
        .then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total };
  })

  static getUserOwnedCardsBySubcategory = maybeTransaction('getUserOwnedCardsBySubcategory', async (
    client, userId: number, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const PREVIEW_CAP = 10;
    const { query, limit = 10, offset = 0 } = opts;
    const cardMatch = query ? ilike(cards.name, `%${query}%`) : undefined;
    const where = cardMatch ? and(eq(userCards.userId, userId), cardMatch) : eq(userCards.userId, userId);

    const [subcategoryRows, totalSubcategories] = await Promise.all([
      client
        .select({
          subcategoryId: subcategories.id,
          subcategoryName: subcategories.name,
          categoryEmoji: categories.emoji,
          categoryName: categories.name,
          total: sql<number>`CAST(COUNT(*) AS INTEGER)`,
        })
        .from(userCards)
        .innerJoin(cards, eq(cards.id, userCards.cardId))
        .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .innerJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(where)
        .groupBy(subcategories.id, categories.id)
        .orderBy(subcategories.id)
        .limit(limit)
        .offset(offset),
      client
        .select({ total: sql<number>`CAST(COUNT(DISTINCT ${subcategories.id}) AS INTEGER)` })
        .from(userCards)
        .innerJoin(cards, eq(cards.id, userCards.cardId))
        .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .where(where)
        .then(r => r[0]?.total ?? 0),
    ]);

    type CardRow = {
      subcategoryId: number; id: number; name: string; imageUrl: string | null;
      rarityName: string; rarityEmoji: string; ownedCount: number;
    };
    const subcategoryIds = subcategoryRows.map(r => r.subcategoryId);
    const cardsBySubcategory = new Map<number, CardRow[]>();

    if (subcategoryIds.length > 0) {
      const cardWhere = cardMatch
        ? and(eq(userCards.userId, userId), inArray(subcategories.id, subcategoryIds), cardMatch)
        : and(eq(userCards.userId, userId), inArray(subcategories.id, subcategoryIds));

      const cardRows = await client
        .select({
          subcategoryId: subcategories.id,
          id: cards.id,
          name: cards.name,
          imageUrl: cards.imageUrl,
          rarityName: rarities.name,
          rarityEmoji: rarities.emoji,
          ownedCount: userCards.count,
        })
        .from(userCards)
        .innerJoin(cards, eq(cards.id, userCards.cardId))
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .where(cardWhere)
        .orderBy(desc(cards.rarityId), cards.id);

      for (const row of cardRows) {
        const list = cardsBySubcategory.get(row.subcategoryId) ?? [];
        if (list.length < PREVIEW_CAP) list.push(row);
        cardsBySubcategory.set(row.subcategoryId, list);
      }
    }

    const rows = subcategoryRows.map(sub => ({
      ...sub,
      cards: cardsBySubcategory.get(sub.subcategoryId) ?? [],
    }));

    return { rows, total: totalSubcategories };
  })

  static getUserCollectionProgress = maybeTransaction('getUserCollectionProgress', async (
    client, userId: number,
    opts: {
      query?: string; limit?: number; offset?: number; sortBy?: 'default' | 'closest';
      completionFilter?: 'all' | 'incomplete' | 'completed';
    } = {},
  ) => {
    const { query, limit = 20, offset = 0, sortBy = 'default', completionFilter = 'all' } = opts;
    const where = query ? ilike(subcategories.name, `%${query}%`) : undefined;
    const ownedExpr = sql`COUNT(DISTINCT CASE WHEN ${userCards.count} > 0 THEN ${cardSubcategories.cardId} END)`;
    const totalExpr = sql`COUNT(DISTINCT ${cardSubcategories.cardId})`;
    const having = completionFilter === 'incomplete' ? sql`${ownedExpr} < ${totalExpr}`
      : completionFilter === 'completed' ? sql`${ownedExpr} = ${totalExpr}`
      : undefined;

    const rows = await client
      .select({
        subcategoryId: subcategories.id,
        subcategoryName: subcategories.name,
        categoryName: categories.name,
        imageUrl: subcategories.imageUrl,
        total: sql<number>`CAST(${totalExpr} AS INTEGER)`,
        owned: sql<number>`CAST(${ownedExpr} AS INTEGER)`,
      })
      .from(subcategories)
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .innerJoin(cardSubcategories, and(eq(cardSubcategories.subcategoryId, subcategories.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(userCards, and(eq(userCards.cardId, cardSubcategories.cardId), eq(userCards.userId, userId)))
      .where(where)
      .groupBy(subcategories.id, categories.id)
      .having(having)
      .orderBy(sortBy === 'closest'
        ? sql`(${ownedExpr}::float / NULLIF(${totalExpr}, 0)) DESC, (${totalExpr} - ${ownedExpr}) ASC, ${subcategories.id} ASC`
        : sql`${subcategories.id} ASC`)
      .limit(limit)
      .offset(offset);

    const total = await client
      .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(subcategories)
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .innerJoin(cardSubcategories, and(eq(cardSubcategories.subcategoryId, subcategories.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(userCards, and(eq(userCards.cardId, cardSubcategories.cardId), eq(userCards.userId, userId)))
      .where(where)
      .groupBy(subcategories.id)
      .having(having)
      .then(r => r.length);

    return { rows, total };
  })

  static getUserCollectionStats = maybeTransaction('getUserCollectionStats', async (client, userId: number) => {
    const perSubcategory = await client
      .select({
        total: sql<number>`CAST(COUNT(DISTINCT ${cardSubcategories.cardId}) AS INTEGER)`,
        owned: sql<number>`CAST(COUNT(DISTINCT CASE WHEN ${userCards.count} > 0 THEN ${cardSubcategories.cardId} END) AS INTEGER)`,
      })
      .from(subcategories)
      .innerJoin(cardSubcategories, and(eq(cardSubcategories.subcategoryId, subcategories.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(userCards, and(eq(userCards.cardId, cardSubcategories.cardId), eq(userCards.userId, userId)))
      .groupBy(subcategories.id);

    return {
      completed: perSubcategory.filter(s => s.total > 0 && s.owned === s.total).length,
      total: perSubcategory.length,
    };
  })

  static discardUserCard = maybeTransaction('discardUserCard', async (client, userId: number, cardId: number) => {
    const [owned] = await client
      .select({ count: userCards.count, rarityName: rarities.name })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1);

    if (!owned || owned.count <= 0) return null;

    const reward = CARD_DISCARD_REWARDS[owned.rarityName] ?? 0;

    if (owned.count <= 1) {
      await client.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    } else {
      await client.update(userCards).set({ count: sql`${userCards.count} - 1` }).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    }

    if (reward > 0) {
      await client.update(users).set({ coins: sql`${users.coins} + ${reward}` }).where(eq(users.id, userId));
    }

    return { remainingCount: Math.max(0, owned.count - 1), coinsAwarded: reward };
  })

  static discardUserCards = maybeTransaction('discardUserCards', async (client, userId: number, cardIds: number[]) => {
    const uniqueIds = [...new Set(cardIds)];
    if (uniqueIds.length === 0) return { ok: true as const, results: [], totalCoinsAwarded: 0 };

    const owned = await client
      .select({ cardId: userCards.cardId, count: userCards.count, rarityName: rarities.name })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(and(eq(userCards.userId, userId), inArray(userCards.cardId, uniqueIds)));

    const ownedById = new Map(owned.map(o => [o.cardId, o]));

    for (const cardId of uniqueIds) {
      const row = ownedById.get(cardId);
      if (!row || row.count <= 0) return { ok: false as const, reason: 'missing_or_not_owned' as const, cardId };
    }

    const results: { cardId: number; remainingCount: number; coinsAwarded: number }[] = [];
    let totalCoinsAwarded = 0;

    for (const cardId of uniqueIds) {
      const row = ownedById.get(cardId)!;
      const reward = CARD_DISCARD_REWARDS[row.rarityName] ?? 0;

      if (row.count <= 1) {
        await client.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      } else {
        await client.update(userCards).set({ count: sql`${userCards.count} - 1` }).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      }

      results.push({ cardId, remainingCount: Math.max(0, row.count - 1), coinsAwarded: reward });
      totalCoinsAwarded += reward;
    }

    if (totalCoinsAwarded > 0) {
      await client.update(users).set({ coins: sql`${users.coins} + ${totalCoinsAwarded}` }).where(eq(users.id, userId));
    }

    return { ok: true as const, results, totalCoinsAwarded };
  })

  static deleteSubcategory = maybeTransaction('deleteSubcategory', async (client, id: number) => {
    const cardCount = await client
      .select({ cardCount: sql<number>`CAST(COUNT(${cardSubcategories.cardId}) AS INTEGER)` })
      .from(cardSubcategories)
      .where(eq(cardSubcategories.subcategoryId, id))
      .then(rows => rows[0]?.cardCount ?? 0);
    if (cardCount > 0) return { ok: false as const, reason: 'has_cards' as const };

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
