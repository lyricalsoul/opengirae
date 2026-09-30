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
  wishlist,
  subcategoryGoals,
  cardCustomizationSubmissions,
  subcategoryCompletionRewards,
  hipotecaSessions,
  hipotecaHoldings,
  auctions,
} from "./schemas/cards";
import { users } from "./schemas/users";
import { eq, and, sql, ilike, desc, gte, gt, inArray, isNull, lt } from "drizzle-orm";
import { CARD_DISCARD_REWARDS, SUBCATEGORY_COMPLETION_BONUS_MULTIPLIER, calculateCardDiscardReward } from "./constants";
import { EconomyDB } from "./economy";
import { DiscotecaDB } from "./discoteca";
import type { DrizzleClient } from "./decorators";

export interface CativeiroSubmitter {
  platform: string;
  platformId: string;
  name: string;
  chatId: string;
  threadId?: string;
}

export interface CompletedSubcategory {
  subcategoryId: number;
  subcategoryName: string;
  coinsAwarded: number;
}

// AuditDB.revertDonation's penalty chain - see applyDonationRevertPenaltyWithClient.
export const DONATION_REVERT_PENALTY_COINS = 1000;
export type DonationRevertPenalty =
  | { ok: true; penalty: 'card_returned' }
  | { ok: true; penalty: 'draw_taken' }
  | { ok: true; penalty: 'coins_taken'; amount: number }
  | { ok: true; penalty: 'same_tier_card_taken'; takenCardId: number }
  | { ok: false };

// the rarity /hipoteca holds - shared by the command layer's getUserCardsByRarityName call and this file's own filter
export const HIPOTECA_RARITY_NAME = 'Lendário';

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
        cativeiroThreshold: rarities.cativeiroThreshold,
        subcategoryEmoji: sql<string | null>`COALESCE(${subcategories.emoji}, ${categories.emoji})`,
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

  static getCardsWithDetailsByIds = maybeTransaction('getCardsWithDetailsByIds', async (client, ids: number[]) => {
    if (ids.length === 0) return [];
    return await client
      .select({
        id: cards.id,
        name: cards.name,
        imageUrl: cards.imageUrl,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
        categoryEmoji: categories.emoji,
        subcategoryName: subcategories.name,
        subcategoryEmoji: sql<string | null>`COALESCE(${subcategories.emoji}, ${categories.emoji})`,
      })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .leftJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(inArray(cards.id, ids))
      .orderBy(cards.id); // stable order - Postgres gives none by default, so callers displaying a grid would otherwise see rows reshuffle between identical requests
  })

  static getCardsByIds = maybeTransaction('getCardsByIds', async (client, ids: number[]) => {
    if (ids.length === 0) return [];
    return await client
      .select({
        id: cards.id,
        name: cards.name,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
      })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(inArray(cards.id, ids));
  })

  static getOwnedCardQuantities = maybeTransaction('getOwnedCardQuantities', async (client, userId: number, cardIds: number[]) => {
    if (cardIds.length === 0) return [];
    return await client
      .select({ cardId: userCards.cardId, count: userCards.count })
      .from(userCards)
      .where(and(eq(userCards.userId, userId), inArray(userCards.cardId, cardIds), gte(userCards.count, 1)));
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

  static getCardByAlias = maybeTransaction('getCardByAlias', async (client, alias: string) => {
    const normalized = alias.trim().toLowerCase();
    return await client
      .select()
      .from(cards)
      .where(sql`${normalized} = ANY(${cards.aliases})`)
      .limit(1)
      .then(a => a?.[0]);
  })

  static addCardAlias = maybeTransaction('addCardAlias', async (client, cardId: number, alias: string) => {
    const normalized = alias.trim().toLowerCase();
    return await client
      .update(cards)
      .set({
        aliases: sql`CASE WHEN ${normalized} = ANY(coalesce(${cards.aliases}, ARRAY[]::text[]))
          THEN coalesce(${cards.aliases}, ARRAY[]::text[])
          ELSE array_append(coalesce(${cards.aliases}, ARRAY[]::text[]), ${normalized}) END`,
      })
      .where(eq(cards.id, cardId))
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

  static addCardSubcategory = maybeTransaction('addCardSubcategory', async (client, cardId: number, subcategoryId: number) => {
    await client.insert(cardSubcategories)
      .values({ cardId, subcategoryId, isMain: false })
      .onConflictDoNothing({ target: [cardSubcategories.cardId, cardSubcategories.subcategoryId] });
  })

  static getCardSubcategoryEntry = maybeTransaction('getCardSubcategoryEntry', async (client, cardId: number, subcategoryId: number) => {
    return await client.select().from(cardSubcategories)
      .where(and(eq(cardSubcategories.cardId, cardId), eq(cardSubcategories.subcategoryId, subcategoryId)))
      .limit(1).then(a => a?.[0]);
  })

  static removeCardSubcategory = maybeTransaction('removeCardSubcategory', async (client, cardId: number, subcategoryId: number) => {
    await client.delete(cardSubcategories)
      .where(and(eq(cardSubcategories.cardId, cardId), eq(cardSubcategories.subcategoryId, subcategoryId), eq(cardSubcategories.isMain, false)));
  })

  static deleteCard = maybeTransaction('deleteCard', async (client, cardId: number) => {
    await client.delete(cardSubcategories).where(eq(cardSubcategories.cardId, cardId));
    await client.delete(cards).where(eq(cards.id, cardId));
  })

  static getUserCardsByRarityName = maybeTransaction('getUserCardsByRarityName', async (client, userId: number, rarityName: string) => {
    return await client
      .select({ cardId: cards.id, name: cards.name, rarityEmoji: rarities.emoji, count: userCards.count })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(and(eq(userCards.userId, userId), eq(rarities.name, rarityName), gt(userCards.count, 0)))
      .orderBy(cards.name);
  })

  static getActiveHipotecaSession = maybeTransaction('getActiveHipotecaSession', async (client, userId: number) => {
    const session = await client.select().from(hipotecaSessions).where(eq(hipotecaSessions.userId, userId)).limit(1).then(a => a?.[0]);
    if (!session) return undefined;

    const holdings = await client
      .select({ cardId: cards.id, name: cards.name, rarityEmoji: rarities.emoji, count: hipotecaHoldings.count })
      .from(hipotecaHoldings)
      .innerJoin(cards, eq(cards.id, hipotecaHoldings.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(eq(hipotecaHoldings.sessionId, session.id));

    return { ...session, holdings };
  })

  static applyHipoteca = async (userId: number, staffId: number) => {
    try {
      return await CardsDB.applyHipotecaTx(userId, staffId);
    } catch (e) {
      // drizzle-orm 0.45 wraps the raw pg error (with .code) as .cause.
      const code = (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === '23505') return { ok: false as const, reason: 'already_active' as const };
      throw e;
    }
  }

  private static applyHipotecaTx = maybeTransaction('applyHipoteca', async (client, userId: number, staffId: number) => {
    // pre-check for the nicer error: an active hold already emptied user_cards, so the DELETE below would
    // misreport nothing_to_hold. Real TOCTOU-safe guard is the unique index on userId, caught as 23505 above.
    const existingSession = await client.select({ id: hipotecaSessions.id }).from(hipotecaSessions).where(eq(hipotecaSessions.userId, userId)).limit(1).then(a => a?.[0]);
    if (existingSession) return { ok: false as const, reason: 'already_active' as const };

    const heldIdRows = await client
      .select({ cardId: userCards.cardId, name: cards.name })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(and(eq(userCards.userId, userId), eq(rarities.name, HIPOTECA_RARITY_NAME), gt(userCards.count, 0)));

    if (heldIdRows.length === 0) return { ok: false as const, reason: 'nothing_to_hold' as const };
    const nameByCardId = new Map(heldIdRows.map(r => [r.cardId, r.name]));

    const currentUser = await client.select({ luckModifier: users.luckModifier }).from(users).where(eq(users.id, userId)).limit(1).then(a => a?.[0]);
    if (!currentUser) return { ok: false as const, reason: 'nothing_to_hold' as const };

    const session = await client.insert(hipotecaSessions)
      .values({ userId, staffId, savedLuckModifier: currentUser.luckModifier })
      .returning()
      .then(a => a?.[0]);
    if (!session) return { ok: false as const, reason: 'nothing_to_hold' as const };

    // DELETE...RETURNING instead of an earlier SELECT: what's actually removed is what gets held, so a
    // concurrent draw/trade/gift between the selects above and this delete can't vanish extra copies.
    const deletedRows = await client.delete(userCards)
      .where(and(eq(userCards.userId, userId), inArray(userCards.cardId, [...nameByCardId.keys()])))
      .returning();

    if (deletedRows.length === 0) return { ok: false as const, reason: 'nothing_to_hold' as const };

    await client.insert(hipotecaHoldings).values(
      deletedRows.map(r => ({
        sessionId: session.id,
        cardId: r.cardId,
        count: r.count,
        tradable: r.tradable,
        customEmoji: r.customEmoji,
        customMediaUrl: r.customMediaUrl,
        customMediaType: r.customMediaType,
      }))
    );
    await client.update(users).set({ luckModifier: 0 }).where(eq(users.id, userId));

    return {
      ok: true as const,
      sessionId: session.id,
      cards: deletedRows.map(r => ({ cardId: r.cardId, name: nameByCardId.get(r.cardId)!, count: r.count })),
    };
  })

  static liftHipoteca = maybeTransaction('liftHipoteca', async (client, sessionId: number) => {
    // FOR UPDATE so two concurrent lifts of the same session block/miss instead of both granting the cards
    const session = await client.select().from(hipotecaSessions).where(eq(hipotecaSessions.id, sessionId)).for('update').limit(1).then(a => a?.[0]);
    if (!session) return null;

    const holdings = await client
      .select({
        cardId: hipotecaHoldings.cardId,
        name: cards.name,
        count: hipotecaHoldings.count,
        tradable: hipotecaHoldings.tradable,
        customEmoji: hipotecaHoldings.customEmoji,
        customMediaUrl: hipotecaHoldings.customMediaUrl,
        customMediaType: hipotecaHoldings.customMediaType,
      })
      .from(hipotecaHoldings)
      .innerJoin(cards, eq(cards.id, hipotecaHoldings.cardId))
      .where(eq(hipotecaHoldings.sessionId, sessionId));

    if (holdings.length > 0) {
      await client.insert(userCards)
        .values(holdings.map(h => ({
          userId: session.userId,
          cardId: h.cardId,
          count: h.count,
          tradable: h.tradable,
          customEmoji: h.customEmoji,
          customMediaUrl: h.customMediaUrl,
          customMediaType: h.customMediaType,
        })))
        .onConflictDoUpdate({
          target: [userCards.userId, userCards.cardId],
          // merges count, and only fills custom* in if the existing row doesn't already have them - never clobbers a real value
          set: {
            count: sql`${userCards.count} + excluded.${sql.identifier(userCards.count.name)}`,
            customEmoji: sql`coalesce(${userCards.customEmoji}, excluded.${sql.identifier(userCards.customEmoji.name)})`,
            customMediaUrl: sql`coalesce(${userCards.customMediaUrl}, excluded.${sql.identifier(userCards.customMediaUrl.name)})`,
            customMediaType: sql`coalesce(${userCards.customMediaType}, excluded.${sql.identifier(userCards.customMediaType.name)})`,
          },
        });
    }

    await client.update(users).set({ luckModifier: session.savedLuckModifier }).where(eq(users.id, session.userId));
    await client.delete(hipotecaSessions).where(eq(hipotecaSessions.id, sessionId)); // cascades hipoteca_holdings

    return { cards: holdings.map(h => ({ cardId: h.cardId, name: h.name, count: h.count })) };
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

  static getAllOwnedCardIds = maybeTransaction('getAllOwnedCardIds', async (client, userId: number) => {
    return await client
      .select({ cardId: userCards.cardId, count: userCards.count })
      .from(userCards)
      .where(and(eq(userCards.userId, userId), gt(userCards.count, 0)));
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

  static getSubcategoryIdsForCard = maybeTransaction('getSubcategoryIdsForCard', async (client, cardId: number): Promise<number[]> => {
    const rows = await client.select({ subcategoryId: cardSubcategories.subcategoryId }).from(cardSubcategories).where(eq(cardSubcategories.cardId, cardId));
    return rows.map(r => r.subcategoryId);
  })

  // completeness and "not already claimed" are both folded into this one INSERT, TOCTOU-safe; takes the caller's own client so it can join an already-open transaction.
  private static async claimSubcategoryCompletionRewardWithClient(
    client: DrizzleClient, userId: number, subcategoryId: number, incomeInflationRate: number,
  ): Promise<{ ok: true; coinsAwarded: number } | { ok: false; reason: 'not_complete' }> {
    const membership = await client
      .select({ rarityName: rarities.name })
      .from(cardSubcategories)
      .innerJoin(cards, eq(cards.id, cardSubcategories.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(eq(cardSubcategories.subcategoryId, subcategoryId));
    if (membership.length === 0) return { ok: false, reason: 'not_complete' };

    const baseSum = membership.reduce((sum, row) => sum + (CARD_DISCARD_REWARDS[row.rarityName] ?? 0), 0);
    const coinsAwarded = Math.round(baseSum * SUBCATEGORY_COMPLETION_BONUS_MULTIPLIER * incomeInflationRate);

    const result = await client.execute<{ coinsAwarded: number }>(sql`
      INSERT INTO ${subcategoryCompletionRewards}
        (${sql.identifier(subcategoryCompletionRewards.userId.name)}, ${sql.identifier(subcategoryCompletionRewards.subcategoryId.name)}, ${sql.identifier(subcategoryCompletionRewards.coinsAwarded.name)})
      SELECT ${userId}, ${subcategoryId}, ${coinsAwarded}
      WHERE NOT EXISTS (
        SELECT 1 FROM ${cardSubcategories}
        LEFT JOIN ${userCards} ON ${userCards.cardId} = ${cardSubcategories.cardId} AND ${userCards.userId} = ${userId}
        WHERE ${cardSubcategories.subcategoryId} = ${subcategoryId} AND COALESCE(${userCards.count}, 0) = 0
      )
      ON CONFLICT (${sql.identifier(subcategoryCompletionRewards.userId.name)}, ${sql.identifier(subcategoryCompletionRewards.subcategoryId.name)}) DO NOTHING
      RETURNING ${sql.identifier(subcategoryCompletionRewards.coinsAwarded.name)}
    `);

    const claimed = result.rows[0];
    if (!claimed) return { ok: false, reason: 'not_complete' }; // already claimed, or not actually complete

    await client.update(users).set({ coins: sql`${users.coins} + ${claimed.coinsAwarded}` }).where(eq(users.id, userId));
    return { ok: true, coinsAwarded: claimed.coinsAwarded };
  }

  private static claimSubcategoryCompletionRewardTx = maybeTransaction('claimSubcategoryCompletionReward', async (
    client, userId: number, subcategoryId: number, incomeInflationRate: number,
  ) => {
    return await CardsDB.claimSubcategoryCompletionRewardWithClient(client, userId, subcategoryId, incomeInflationRate);
  })

  // standalone entry point (opens its own transaction) - used by /clc and /clcimg's backfill check.
  static claimSubcategoryCompletionReward = async (userId: number, subcategoryId: number) => {
    const incomeInflationRate = await EconomyDB.getIncomeInflationRate();
    return await CardsDB.claimSubcategoryCompletionRewardTx(userId, subcategoryId, incomeInflationRate);
  }

  // shared by addUserCard/runBulkDraws/executeTrade. Not private: gacha.ts calls this too.
  static async claimCompletionsForCardGain(
    client: DrizzleClient, userId: number, cardId: number, incomeInflationRate: number,
  ): Promise<CompletedSubcategory[]> {
    const subcategoryIds = await client.select({ id: cardSubcategories.subcategoryId }).from(cardSubcategories).where(eq(cardSubcategories.cardId, cardId));
    const results: CompletedSubcategory[] = [];
    for (const { id: subcategoryId } of subcategoryIds) {
      const claim = await CardsDB.claimSubcategoryCompletionRewardWithClient(client, userId, subcategoryId, incomeInflationRate);
      if (claim.ok) {
        const [subcategory] = await client.select({ name: subcategories.name }).from(subcategories).where(eq(subcategories.id, subcategoryId)).limit(1);
        results.push({ subcategoryId, subcategoryName: subcategory?.name ?? '?', coinsAwarded: claim.coinsAwarded });
      }
    }
    return results;
  }

  static async claimCompletionsForCardsGainBatch(
    client: DrizzleClient, userId: number, cardIds: number[], incomeInflationRate: number,
  ): Promise<Map<number, CompletedSubcategory[]>> {
    const resultsByCard = new Map<number, CompletedSubcategory[]>(cardIds.map(id => [id, []]));
    if (cardIds.length === 0) return resultsByCard;

    const memberships = await client
      .select({ cardId: cardSubcategories.cardId, subcategoryId: cardSubcategories.subcategoryId })
      .from(cardSubcategories)
      .where(inArray(cardSubcategories.cardId, cardIds));
    const subcategoryIdsByCard = new Map<number, number[]>();
    for (const { cardId, subcategoryId } of memberships) {
      const list = subcategoryIdsByCard.get(cardId) ?? [];
      list.push(subcategoryId);
      subcategoryIdsByCard.set(cardId, list);
    }

    const ownerCardBySubcategory = new Map<number, number>();
    for (const cardId of cardIds) {
      for (const subcategoryId of subcategoryIdsByCard.get(cardId) ?? []) {
        if (!ownerCardBySubcategory.has(subcategoryId)) ownerCardBySubcategory.set(subcategoryId, cardId);
      }
    }

    const claimedByCard = new Map<number, { subcategoryId: number; coinsAwarded: number }[]>();
    for (const [subcategoryId, cardId] of ownerCardBySubcategory) {
      const claim = await CardsDB.claimSubcategoryCompletionRewardWithClient(client, userId, subcategoryId, incomeInflationRate);
      if (claim.ok) {
        const list = claimedByCard.get(cardId) ?? [];
        list.push({ subcategoryId, coinsAwarded: claim.coinsAwarded });
        claimedByCard.set(cardId, list);
      }
    }
    if (claimedByCard.size === 0) return resultsByCard;

    const claimedSubcategoryIds = [...claimedByCard.values()].flatMap(list => list.map(c => c.subcategoryId));
    const names = await client.select({ id: subcategories.id, name: subcategories.name }).from(subcategories).where(inArray(subcategories.id, claimedSubcategoryIds));
    const nameById = new Map(names.map(n => [n.id, n.name]));

    for (const [cardId, claims] of claimedByCard) {
      resultsByCard.set(cardId, claims.map(c => ({ subcategoryId: c.subcategoryId, subcategoryName: nameById.get(c.subcategoryId) ?? '?', coinsAwarded: c.coinsAwarded })));
    }
    return resultsByCard;
  }

  // TODO: would be cleaner as a raw SQL query
  static async addUserCardWithClient(client: DrizzleClient, userId: number, cardId: number, incomeInflationRate: number) {
    const existing = await client
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1)
      .then((a) => a?.[0]);

    if (existing) {
      const updated = await client
        .update(userCards)
        .set({ count: sql`${userCards.count} + 1` })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
        .returning()
        .then(a => a?.[0]);
      if (!updated) return undefined;
      const completedSubcategories = await CardsDB.claimCompletionsForCardGain(client, userId, cardId, incomeInflationRate);
      return { ...updated, previousCount: existing.count, completedSubcategories };
    }

    const user = await client
      .select({ makeCardsTradeableByDefault: users.makeCardsTradeableByDefault })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then(a => a?.[0]);

    const inserted = await client.insert(userCards)
      .values({ userId, cardId, tradable: user?.makeCardsTradeableByDefault ?? false })
      .returning()
      .then(a => a?.[0]);
    if (!inserted) return undefined;
    const completedSubcategories = await CardsDB.claimCompletionsForCardGain(client, userId, cardId, incomeInflationRate);
    return { ...inserted, previousCount: 0, completedSubcategories };
  }

  static addUserCard = maybeTransaction('addUserCard', async (client, userId: number, cardId: number, incomeInflationRate: number) => {
    return await CardsDB.addUserCardWithClient(client, userId, cardId, incomeInflationRate);
  })

  // grants `count` copies in one write instead of addUserCard's +1 looped N times.
  static grantUserCards = maybeTransaction('grantUserCards', async (client, userId: number, cardId: number, count: number, incomeInflationRate: number) => {
    const existing = await client
      .select({ count: userCards.count })
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1)
      .then(a => a?.[0]);
    const previousCount = existing?.count ?? 0;

    const user = await client
      .select({ makeCardsTradeableByDefault: users.makeCardsTradeableByDefault })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then(a => a?.[0]);

    await client.insert(userCards)
      .values({ userId, cardId, count, tradable: user?.makeCardsTradeableByDefault ?? false })
      .onConflictDoUpdate({ target: [userCards.userId, userCards.cardId], set: { count: sql`${userCards.count} + ${count}` } });

    const completedSubcategories = await CardsDB.claimCompletionsForCardGain(client, userId, cardId, incomeInflationRate);
    return { previousCount, newCount: previousCount + count, completedSubcategories };
  })

  // unlike discardUserCards, awards no coins - this is a confiscation, not a voluntary discard.
  static removeUserCards = maybeTransaction('removeUserCards', async (client, userId: number, cardId: number, count: number): Promise<
    { ok: true; remainingCount: number } | { ok: false }
  > => {
    const cardRow = await client
      .select({ cativeiroThreshold: rarities.cativeiroThreshold })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(eq(cards.id, cardId))
      .limit(1)
      .then(a => a?.[0]);
    if (!cardRow) return { ok: false };

    const [updated] = await client
      .update(userCards)
      .set({ count: sql`${userCards.count} - ${count}` })
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId), gte(userCards.count, count)))
      .returning();
    if (!updated) return { ok: false };

    if (updated.count === 0) {
      await client.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    } else if (updated.count < cardRow.cativeiroThreshold) {
      await client
        .update(userCards)
        .set({ customEmoji: null, customMediaUrl: null, customMediaType: null })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    }

    return { ok: true, remainingCount: updated.count };
  })

  static executeTrade = maybeTransaction('executeTrade', async (
    client,
    userAId: number, offerA: { cardId: number; count: number }[],
    userBId: number, offerB: { cardId: number; count: number }[],
    incomeInflationRate: number,
  ) => {
    if (userAId === userBId) throw new Error('executeTrade: userAId and userBId must differ');
    for (const offer of [offerA, offerB]) {
      const ids = offer.map(o => o.cardId);
      if (new Set(ids).size !== ids.length) throw new Error('executeTrade: an offer must not list the same cardId twice');
      if (offer.some(o => o.count <= 0)) throw new Error('executeTrade: offer counts must be positive');
    }

    // pre-fetch thresholds for every offered card up front, avoiding an N+1 in decrement().
    const allOfferedCardIds = [...offerA, ...offerB].map(o => o.cardId);
    const thresholds = allOfferedCardIds.length
      ? await client
        .select({ cardId: cards.id, cativeiroThreshold: rarities.cativeiroThreshold })
        .from(cards)
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .where(inArray(cards.id, allOfferedCardIds))
      : [];
    const thresholdByCardId = new Map(thresholds.map(t => [t.cardId, t.cativeiroThreshold]));

    // needed so a newly-received card (no existing userCards row) respects the recipient's /autotroca default.
    const tradeableDefaults = await client
      .select({ id: users.id, makeCardsTradeableByDefault: users.makeCardsTradeableByDefault })
      .from(users)
      .where(inArray(users.id, [userAId, userBId]));
    const defaultTradableByUserId = new Map(tradeableDefaults.map(u => [u.id, u.makeCardsTradeableByDefault]));

    const decrement = async (userId: number, cardId: number, count: number) => {
      const [row] = await client
        .update(userCards)
        .set({ count: sql`${userCards.count} - ${count}` })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId), gte(userCards.count, count)))
        .returning();
      if (!row) throw new InsufficientCardError(userId, cardId);
      if (row.count === 0) {
        await client.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
        return;
      }

      // no longer eligible - clear any customization.
      const threshold = thresholdByCardId.get(cardId) ?? 0;
      if (row.count < threshold) {
        await client
          .update(userCards)
          .set({ customEmoji: null, customMediaUrl: null, customMediaType: null })
          .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      }
    };

    const crossings: { userId: number; cardId: number; previousCount: number; newCount: number; completedSubcategories?: CompletedSubcategory[] }[] = [];

    const increment = async (userId: number, cardId: number, count: number) => {
      const existing = await client
        .select()
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
        .limit(1)
        .then(a => a?.[0]);

      const previousCount = existing?.count ?? 0;

      if (existing) {
        await client
          .update(userCards)
          .set({ count: sql`${userCards.count} + ${count}` })
          .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      } else {
        await client.insert(userCards).values({ userId, cardId, count, tradable: defaultTradableByUserId.get(userId) ?? false });
      }

      const completedSubcategories = await CardsDB.claimCompletionsForCardGain(client, userId, cardId, incomeInflationRate);
      crossings.push({ userId, cardId, previousCount, newCount: previousCount + count, completedSubcategories });
    };

    for (const { cardId, count } of offerA) await decrement(userAId, cardId, count);
    for (const { cardId, count } of offerB) await decrement(userBId, cardId, count);
    for (const { cardId, count } of offerA) await increment(userBId, cardId, count);
    for (const { cardId, count } of offerB) await increment(userAId, cardId, count);

    const trade = await client
      .insert(trades)
      .values({
        user1Id: userAId,
        user2Id: userBId,
        cardsUser1: offerA.flatMap(o => Array(o.count).fill(o.cardId)),
        cardsUser2: offerB.flatMap(o => Array(o.count).fill(o.cardId)),
      })
      .returning()
      .then(a => a?.[0]);

    return { trade, crossings };
  })

  // same as executeTrade (untouched, still the plain card-only path), but each side can also offer Discoteca entries, in one atomic transaction.
  static executeMixedTrade = maybeTransaction('executeMixedTrade', async (
    client,
    userAId: number, cardOfferA: { cardId: number; count: number }[], discoOfferA: { entryId: number; count: number }[],
    userBId: number, cardOfferB: { cardId: number; count: number }[], discoOfferB: { entryId: number; count: number }[],
    incomeInflationRate: number,
  ) => {
    if (userAId === userBId) throw new Error('executeMixedTrade: userAId and userBId must differ');
    for (const offer of [cardOfferA, cardOfferB]) {
      const ids = offer.map(o => o.cardId);
      if (new Set(ids).size !== ids.length) throw new Error('executeMixedTrade: an offer must not list the same cardId twice');
      if (offer.some(o => o.count <= 0)) throw new Error('executeMixedTrade: offer counts must be positive');
    }
    for (const offer of [discoOfferA, discoOfferB]) {
      const ids = offer.map(o => o.entryId);
      if (new Set(ids).size !== ids.length) throw new Error('executeMixedTrade: an offer must not list the same discoteca entry twice');
      if (offer.some(o => o.count <= 0)) throw new Error('executeMixedTrade: offer counts must be positive');
    }

    const allOfferedCardIds = [...cardOfferA, ...cardOfferB].map(o => o.cardId);
    const thresholds = allOfferedCardIds.length
      ? await client
        .select({ cardId: cards.id, cativeiroThreshold: rarities.cativeiroThreshold })
        .from(cards)
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .where(inArray(cards.id, allOfferedCardIds))
      : [];
    const thresholdByCardId = new Map(thresholds.map(t => [t.cardId, t.cativeiroThreshold]));

    // needed so a newly-received card (no existing userCards row) respects the recipient's /autotroca default.
    const tradeableDefaults = await client
      .select({ id: users.id, makeCardsTradeableByDefault: users.makeCardsTradeableByDefault })
      .from(users)
      .where(inArray(users.id, [userAId, userBId]));
    const defaultTradableByUserId = new Map(tradeableDefaults.map(u => [u.id, u.makeCardsTradeableByDefault]));

    const decrementCard = async (userId: number, cardId: number, count: number) => {
      const [row] = await client
        .update(userCards)
        .set({ count: sql`${userCards.count} - ${count}` })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId), gte(userCards.count, count)))
        .returning();
      if (!row) throw new InsufficientCardError(userId, cardId);
      if (row.count === 0) {
        await client.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
        return;
      }
      const threshold = thresholdByCardId.get(cardId) ?? 0;
      if (row.count < threshold) {
        await client
          .update(userCards)
          .set({ customEmoji: null, customMediaUrl: null, customMediaType: null })
          .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      }
    };

    const crossings: { userId: number; cardId: number; previousCount: number; newCount: number; completedSubcategories?: CompletedSubcategory[] }[] = [];

    const incrementCard = async (userId: number, cardId: number, count: number) => {
      const existing = await client
        .select()
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
        .limit(1)
        .then(a => a?.[0]);

      const previousCount = existing?.count ?? 0;
      if (existing) {
        await client
          .update(userCards)
          .set({ count: sql`${userCards.count} + ${count}` })
          .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      } else {
        await client.insert(userCards).values({ userId, cardId, count, tradable: defaultTradableByUserId.get(userId) ?? false });
      }

      const completedSubcategories = await CardsDB.claimCompletionsForCardGain(client, userId, cardId, incomeInflationRate);
      crossings.push({ userId, cardId, previousCount, newCount: previousCount + count, completedSubcategories });
    };

    for (const { cardId, count } of cardOfferA) await decrementCard(userAId, cardId, count);
    for (const { cardId, count } of cardOfferB) await decrementCard(userBId, cardId, count);
    for (const { entryId, count } of discoOfferA) await DiscotecaDB.decrementForTradeWithClient(client, userAId, entryId, count);
    for (const { entryId, count } of discoOfferB) await DiscotecaDB.decrementForTradeWithClient(client, userBId, entryId, count);

    for (const { cardId, count } of cardOfferA) await incrementCard(userBId, cardId, count);
    for (const { cardId, count } of cardOfferB) await incrementCard(userAId, cardId, count);
    for (const { entryId, count } of discoOfferA) await DiscotecaDB.incrementWithClient(client, userBId, entryId, count);
    for (const { entryId, count } of discoOfferB) await DiscotecaDB.incrementWithClient(client, userAId, entryId, count);

    const trade = await client
      .insert(trades)
      .values({
        user1Id: userAId,
        user2Id: userBId,
        cardsUser1: cardOfferA.flatMap(o => Array(o.count).fill(o.cardId)),
        cardsUser2: cardOfferB.flatMap(o => Array(o.count).fill(o.cardId)),
        discotecaUser1: discoOfferA.flatMap(o => Array(o.count).fill(o.entryId)),
        discotecaUser2: discoOfferB.flatMap(o => Array(o.count).fill(o.entryId)),
      })
      .returning()
      .then(a => a?.[0]);

    return { trade, crossings };
  })

  // Decrements one copy, deleting at 0 and clearing cativeiro customization below threshold - same shape as executeTrade's decrement(), standalone for AuditDB.revertDonation's one-card-at-a-time calls.
  static async tryDecrementOneWithClient(client: DrizzleClient, userId: number, cardId: number): Promise<boolean> {
    const [row] = await client
      .update(userCards)
      .set({ count: sql`${userCards.count} - 1` })
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId), gte(userCards.count, 1)))
      .returning();
    if (!row) return false;

    if (row.count === 0) {
      await client.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      return true;
    }

    const [rarityRow] = await client
      .select({ cativeiroThreshold: rarities.cativeiroThreshold })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(eq(cards.id, cardId))
      .limit(1);
    if (rarityRow && row.count < rarityRow.cativeiroThreshold) {
      await client
        .update(userCards)
        .set({ customEmoji: null, customMediaUrl: null, customMediaType: null })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    }
    return true;
  }

  static async getCardRarityIdWithClient(client: DrizzleClient, cardId: number): Promise<number | null> {
    const [row] = await client.select({ rarityId: cards.rarityId }).from(cards).where(eq(cards.id, cardId)).limit(1);
    return row?.rarityId ?? null;
  }

  // any card of rarityId userId owns - AuditDB.revertDonation's "same tier" fallback step.
  static async findOwnedCardOfRarityWithClient(client: DrizzleClient, userId: number, rarityId: number): Promise<number | null> {
    const [row] = await client
      .select({ cardId: userCards.cardId })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .where(and(eq(userCards.userId, userId), eq(cards.rarityId, rarityId), gte(userCards.count, 1)))
      .orderBy(userCards.cardId)
      .limit(1);
    return row?.cardId ?? null;
  }

  static getTradeStats = maybeTransaction('getTradeStats', async (client, userId: number) => {
    const [initiatedRow, receivedRow] = await Promise.all([
      client.select({ total: sql<string>`count(*)` }).from(trades).where(eq(trades.user1Id, userId)).then(r => r[0]),
      client.select({ total: sql<string>`count(*)` }).from(trades).where(eq(trades.user2Id, userId)).then(r => r[0]),
    ]);

    const topGivenRows = await client
      .select({ partnerId: trades.user2Id, partnerName: users.displayName, count: sql<string>`count(*)` })
      .from(trades)
      .innerJoin(users, eq(users.id, trades.user2Id))
      .where(eq(trades.user1Id, userId))
      .groupBy(trades.user2Id, users.displayName)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    const topReceivedRows = await client
      .select({ partnerId: trades.user1Id, partnerName: users.displayName, count: sql<string>`count(*)` })
      .from(trades)
      .innerJoin(users, eq(users.id, trades.user1Id))
      .where(eq(trades.user2Id, userId))
      .groupBy(trades.user1Id, users.displayName)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    return {
      initiated: Number(initiatedRow?.total ?? 0),
      received: Number(receivedRow?.total ?? 0),
      topGiven: topGivenRows.map(r => ({ partnerId: r.partnerId, partnerName: r.partnerName, count: Number(r.count) })),
      topReceived: topReceivedRows.map(r => ({ partnerId: r.partnerId, partnerName: r.partnerName, count: Number(r.count) })),
    };
  })

  static addCardDrawHistory = maybeTransaction('addCardDrawHistory', async (client, userId: number, cardId: number, categoryId: number, subcategoryId: number) => {
    return await client.insert(cardDrawHistory).values({ userId, cardId, categoryId, subcategoryId }).returning().then(a => a?.[0]);
  })

  static getCategories = maybeTransaction('getCategories', async (client) => {
    return await client
      .select()
      .from(categories)
      .orderBy(categories.id)
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
      .where(sql`immutable_unaccent(${cards.name}) ilike immutable_unaccent(${'%' + query + '%'})`)
      .limit(limit);
  })

  static mergeCards = maybeTransaction('mergeCards', async (client, sourceId: number, targetId: number) => {
    // sum-on-conflict, same shape as UsersDB.mergeUsers - sql.identifier() avoids hand-typed column names, which INSERT/ON CONFLICT require unqualified.
    await client.execute(sql`
      INSERT INTO ${userCards} (${sql.identifier(userCards.userId.name)}, ${sql.identifier(userCards.cardId.name)}, ${sql.identifier(userCards.count.name)}, ${sql.identifier(userCards.tradable.name)}, ${sql.identifier(userCards.updatedAt.name)})
      SELECT ${userCards.userId}, ${targetId}, ${userCards.count}, ${userCards.tradable}, now() FROM ${userCards} WHERE ${userCards.cardId} = ${sourceId}
      ON CONFLICT (${sql.identifier(userCards.userId.name)}, ${sql.identifier(userCards.cardId.name)}) DO UPDATE SET ${sql.identifier(userCards.count.name)} = ${userCards}.${sql.identifier(userCards.count.name)} + excluded.${sql.identifier(userCards.count.name)}
    `);
    await client.delete(userCards).where(eq(userCards.cardId, sourceId));

    await client.execute(sql`
      INSERT INTO ${wishlist} (${sql.identifier(wishlist.userId.name)}, ${sql.identifier(wishlist.cardId.name)}, ${sql.identifier(wishlist.position.name)}, ${sql.identifier(wishlist.createdAt.name)})
      SELECT ${wishlist.userId}, ${targetId}, ${wishlist.position}, ${wishlist.createdAt} FROM ${wishlist} WHERE ${wishlist.cardId} = ${sourceId}
      ON CONFLICT (${sql.identifier(wishlist.userId.name)}, ${sql.identifier(wishlist.cardId.name)}) DO NOTHING
    `);
    await client.delete(wishlist).where(eq(wishlist.cardId, sourceId));

    // composite PK (sessionId, cardId) - same sum-on-conflict shape as user_cards, a session could already hold both cards.
    await client.execute(sql`
      INSERT INTO ${hipotecaHoldings} (${sql.identifier(hipotecaHoldings.sessionId.name)}, ${sql.identifier(hipotecaHoldings.cardId.name)}, ${sql.identifier(hipotecaHoldings.count.name)}, ${sql.identifier(hipotecaHoldings.tradable.name)}, ${sql.identifier(hipotecaHoldings.customEmoji.name)}, ${sql.identifier(hipotecaHoldings.customMediaUrl.name)}, ${sql.identifier(hipotecaHoldings.customMediaType.name)})
      SELECT ${hipotecaHoldings.sessionId}, ${targetId}, ${hipotecaHoldings.count}, ${hipotecaHoldings.tradable}, ${hipotecaHoldings.customEmoji}, ${hipotecaHoldings.customMediaUrl}, ${hipotecaHoldings.customMediaType} FROM ${hipotecaHoldings} WHERE ${hipotecaHoldings.cardId} = ${sourceId}
      ON CONFLICT (${sql.identifier(hipotecaHoldings.sessionId.name)}, ${sql.identifier(hipotecaHoldings.cardId.name)}) DO UPDATE SET ${sql.identifier(hipotecaHoldings.count.name)} = ${hipotecaHoldings}.${sql.identifier(hipotecaHoldings.count.name)} + excluded.${sql.identifier(hipotecaHoldings.count.name)}
    `);
    await client.delete(hipotecaHoldings).where(eq(hipotecaHoldings.cardId, sourceId));

    await client.update(cardDrawHistory).set({ cardId: targetId }).where(eq(cardDrawHistory.cardId, sourceId));
    await client.update(cardCustomizationSubmissions).set({ cardId: targetId }).where(eq(cardCustomizationSubmissions.cardId, sourceId));
    await client.update(users).set({ favoriteCardId: targetId }).where(eq(users.favoriteCardId, sourceId));

    // the source's own subcategory tags aren't meaningful on the target (which has its own) - drop, don't move.
    await client.delete(cardSubcategories).where(eq(cardSubcategories.cardId, sourceId));

    // array columns - a plain UPDATE can't touch individual elements, array_replace swaps every occurrence in place.
    await client.execute(sql`UPDATE ${trades} SET ${sql.identifier(trades.cardsUser1.name)} = array_replace(${trades.cardsUser1}, ${sourceId}, ${targetId}) WHERE ${sourceId} = ANY(${trades.cardsUser1})`);
    await client.execute(sql`UPDATE ${trades} SET ${sql.identifier(trades.cardsUser2.name)} = array_replace(${trades.cardsUser2}, ${sourceId}, ${targetId}) WHERE ${sourceId} = ANY(${trades.cardsUser2})`);

    await client.delete(cards).where(eq(cards.id, sourceId));
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
      .where(sql`immutable_unaccent(${subcategories.name}) ilike immutable_unaccent(${'%' + query + '%'})`)
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
      .leftJoin(cardSubcategories, eq(cardSubcategories.subcategoryId, subcategories.id))
      .where(and(eq(subcategories.categoryId, categoryId), eq(subcategories.isSecondary, false)))
      .groupBy(subcategories.id, subcategories.name)
      .orderBy(subcategories.id);
  })

  // Claims every eligible subcategory and marks its not-yet-announced cards; onlyIds scopes this table-wide UPDATE to a test's own fixtures.
  static claimUnannouncedSubcategories = maybeTransaction('claimUnannouncedSubcategories', async (client, cutoff: Date, onlyIds?: number[]) => {
    const claimConditions = [isNull(subcategories.announcedAt), lt(subcategories.createdAt, cutoff)];
    if (onlyIds) claimConditions.push(inArray(subcategories.id, onlyIds));

    const claimedSubcategories = await client
      .update(subcategories)
      .set({ announcedAt: sql`now()` })
      .where(and(...claimConditions))
      .returning();
    if (claimedSubcategories.length === 0) return [];

    const subcategoryIds = claimedSubcategories.map(s => s.id);
    const categoryIds = [...new Set(claimedSubcategories.map(s => s.categoryId))];
    const categoryEmojiById = new Map(
      (await client.select({ id: categories.id, emoji: categories.emoji }).from(categories).where(inArray(categories.id, categoryIds)))
        .map(c => [c.id, c.emoji] as const)
    );

    const mainCardLinks = await client
      .select({ cardId: cardSubcategories.cardId, subcategoryId: cardSubcategories.subcategoryId })
      .from(cardSubcategories)
      .where(and(inArray(cardSubcategories.subcategoryId, subcategoryIds), eq(cardSubcategories.isMain, true)));
    const subcategoryIdByCardId = new Map(mainCardLinks.map(l => [l.cardId, l.subcategoryId] as const));
    const cardIds = mainCardLinks.map(l => l.cardId);

    // a card moved in from an already-announced subcategory keeps its announcedAt, but is still listed below.
    if (cardIds.length > 0) {
      await client
        .update(cards)
        .set({ announcedAt: sql`now()` })
        .where(and(isNull(cards.announcedAt), inArray(cards.id, cardIds)));
    }

    const allCards = cardIds.length === 0 ? [] : await client
      .select({ id: cards.id, name: cards.name, rarityId: cards.rarityId })
      .from(cards)
      .where(inArray(cards.id, cardIds));

    const rarityIds = [...new Set(allCards.map(c => c.rarityId))];
    const rarityRows = rarityIds.length === 0 ? [] :
      await client.select({ id: rarities.id, emoji: rarities.emoji, weight: rarities.weight }).from(rarities).where(inArray(rarities.id, rarityIds));
    const rarityEmojiById = new Map(rarityRows.map(r => [r.id, r.emoji] as const));
    const rarityWeightById = new Map(rarityRows.map(r => [r.id, r.weight] as const));

    const cardsBySubcategory = new Map<number, { id: number; name: string; rarityEmoji: string; rarityWeight: number }[]>();
    for (const c of allCards) {
      const subcategoryId = subcategoryIdByCardId.get(c.id);
      if (subcategoryId === undefined) continue;
      const list = cardsBySubcategory.get(subcategoryId) ?? [];
      list.push({ id: c.id, name: c.name, rarityEmoji: rarityEmojiById.get(c.rarityId) ?? '', rarityWeight: rarityWeightById.get(c.rarityId) ?? 0 });
      cardsBySubcategory.set(subcategoryId, list);
    }
    // lower weight = rarer (RARITY_RANK_SQL in gacha.ts)
    for (const list of cardsBySubcategory.values()) list.sort((a, b) => a.rarityWeight - b.rarityWeight || a.id - b.id);

    return claimedSubcategories.map(s => ({
      id: s.id,
      name: s.name,
      categoryEmoji: categoryEmojiById.get(s.categoryId) ?? '🏷️',
      imageUrl: s.imageUrl,
      createdAt: s.createdAt,
      cards: (cardsBySubcategory.get(s.id) ?? []).map(({ id, name, rarityEmoji }) => ({ id, name, rarityEmoji })),
    }));
  })

  // Claims every eligible card; ones already claimed via claimUnannouncedSubcategories are skipped naturally. onlyIds: see claimUnannouncedSubcategories's note.
  static claimUnannouncedCards = maybeTransaction('claimUnannouncedCards', async (client, cutoff: Date, onlyIds?: number[]) => {
    const claimConditions = [isNull(cards.announcedAt), lt(cards.createdAt, cutoff)];
    if (onlyIds) claimConditions.push(inArray(cards.id, onlyIds));

    const claimed = await client
      .update(cards)
      .set({ announcedAt: sql`now()` })
      .where(and(...claimConditions))
      .returning({ id: cards.id });
    if (claimed.length === 0) return [];

    return await client
      .select({
        id: cards.id,
        name: cards.name,
        rarityEmoji: rarities.emoji,
        subcategoryId: subcategories.id,
        subcategoryName: subcategories.name,
        subcategoryEmoji: sql<string>`COALESCE(${subcategories.emoji}, ${categories.emoji})`,
        subcategoryImageUrl: subcategories.imageUrl,
      })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(inArray(cards.id, claimed.map(c => c.id)))
      // lower weight = rarer (RARITY_RANK_SQL in gacha.ts)
      .orderBy(subcategories.id, rarities.weight, cards.id);
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
      .where(eq(cardSubcategories.subcategoryId, subcategoryId))
      .orderBy(desc(cards.rarityId), cards.id);
  })

  static getCardsInSubcategoryForUserFiltered = maybeTransaction('getCardsInSubcategoryForUserFiltered', async (
    client, subcategoryId: number, userId: number,
    opts: { ownedFilter?: 'owned' | 'missing'; rarityName?: string; limit: number; offset: number },
  ) => {
    // a card the user is currently /leiloar-ing still counts as "owned" here, even though its
    // stock physically left userCards for the duration - see docs/agent/02-architecture.md's
    // note on the 📣 in-auction marker.
    const inAuctionExpr = sql`EXISTS (SELECT 1 FROM ${auctions} WHERE ${auctions.sellerId} = ${userId} AND ${auctions.cardId} = ${cards.id} AND ${auctions.status} = 'active')`;
    const ownedCondition = sql`(COALESCE(${userCards.count}, 0) > 0 OR ${inAuctionExpr})`;

    const conditions = [eq(cardSubcategories.subcategoryId, subcategoryId)];
    if (opts.ownedFilter === 'owned') conditions.push(ownedCondition);
    if (opts.ownedFilter === 'missing') conditions.push(sql`NOT ${ownedCondition}`);
    if (opts.rarityName) conditions.push(eq(rarities.name, opts.rarityName));

    return await client
      .select({
        id: cards.id,
        name: cards.name,
        imageUrl: cards.imageUrl,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
        categoryEmoji: categories.emoji,
        ownedCount: sql<number>`CAST(COALESCE(${userCards.count}, 0) AS INTEGER)`,
        tradable: sql<boolean>`COALESCE(${userCards.tradable}, false)`,
        inAuction: sql<boolean>`${inAuctionExpr}`,
      })
      .from(cardSubcategories)
      .innerJoin(cards, eq(cards.id, cardSubcategories.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
      .where(and(...conditions))
      .orderBy(desc(cards.rarityId), cards.id)
      .limit(opts.limit)
      .offset(opts.offset);
  })

  static getSubcategoryStats = maybeTransaction('getSubcategoryStats', async (
    client, subcategoryId: number, userId: number,
    opts: { ownedFilter?: 'owned' | 'missing'; rarityName?: string },
  ) => {
    const inAuctionExpr = sql`EXISTS (SELECT 1 FROM ${auctions} WHERE ${auctions.sellerId} = ${userId} AND ${auctions.cardId} = ${cards.id} AND ${auctions.status} = 'active')`;
    const ownedCondition = sql`(COALESCE(${userCards.count}, 0) > 0 OR ${inAuctionExpr})`;

    const filterConditions = [];
    if (opts.ownedFilter === 'owned') filterConditions.push(ownedCondition);
    if (opts.ownedFilter === 'missing') filterConditions.push(sql`NOT ${ownedCondition}`);
    if (opts.rarityName) filterConditions.push(eq(rarities.name, opts.rarityName));
    const filterWhere = filterConditions.length > 0 ? and(...filterConditions) : sql`true`;

    const [row] = await client
      .select({
        total: sql<number>`CAST(COUNT(*) AS INTEGER)`,
        owned: sql<number>`CAST(COUNT(*) FILTER (WHERE ${ownedCondition}) AS INTEGER)`,
        filteredTotal: sql<number>`CAST(COUNT(*) FILTER (WHERE ${filterWhere}) AS INTEGER)`,
      })
      .from(cardSubcategories)
      .innerJoin(cards, eq(cards.id, cardSubcategories.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
      .where(eq(cardSubcategories.subcategoryId, subcategoryId));
    return row ?? { total: 0, owned: 0, filteredTotal: 0 };
  })

  static getUserCardsCount = maybeTransaction('getUserCardsCount', async (client, userId: number): Promise<number> => {
    // a card currently in this user's own active /leiloar is physically out of userCards - see
    // getCardsInSubcategoryForUserFiltered's note - so it's added back in separately here.
    const result = await client
      .select({
        total: sql<number>`CAST(COALESCE(SUM(${userCards.count}), 0) AS INTEGER) + (SELECT CAST(COUNT(*) AS INTEGER) FROM ${auctions} WHERE ${auctions.sellerId} = ${userId} AND ${auctions.status} = 'active')`,
      })
      .from(userCards)
      .where(eq(userCards.userId, userId))
      .then(a => a?.[0]);
    return result?.total ?? 0;
  })

  static getUserOwnedCards = maybeTransaction('getUserOwnedCards', async (client, userId: number) => {
    // same reasoning as getCardsInSubcategoryForUserFiltered: a card currently in this user's
    // own active /leiloar is physically out of userCards for the duration, so membership is a
    // union of "physically owned" and "currently auctioned by this user" instead of a plain
    // userCards scan - otherwise it'd vanish from this list while the auction is live.
    const inAuctionExpr = sql`EXISTS (SELECT 1 FROM ${auctions} WHERE ${auctions.sellerId} = ${userId} AND ${auctions.cardId} = ${cards.id} AND ${auctions.status} = 'active')`;
    const ownedOrAuctionedCardIds = sql`(SELECT ${userCards.cardId} FROM ${userCards} WHERE ${userCards.userId} = ${userId} AND ${userCards.count} > 0 UNION SELECT ${auctions.cardId} FROM ${auctions} WHERE ${auctions.sellerId} = ${userId} AND ${auctions.status} = 'active')`;

    return await client
      .select({
        id: cards.id,
        name: cards.name,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
        categoryId: categories.id,
        categoryEmoji: categories.emoji,
        categoryName: categories.name,
        subcategoryName: subcategories.name,
        ownedCount: sql<number>`CAST(COALESCE(${userCards.count}, 0) AS INTEGER)`,
        inAuction: sql<boolean>`${inAuctionExpr}`,
      })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .leftJoin(categories, eq(categories.id, subcategories.categoryId))
      .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
      .where(sql`${cards.id} IN ${ownedOrAuctionedCardIds}`)
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

  static getDuplicateCards = maybeTransaction('getDuplicateCards', async (
    client, userId: number, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const { query, limit = 20, offset = 0 } = opts;
    const where = query
      ? and(eq(userCards.userId, userId), gt(userCards.count, 1), ilike(cards.name, `%${query}%`))
      : and(eq(userCards.userId, userId), gt(userCards.count, 1));

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

  static getCativeiroEligibleCards = maybeTransaction('getCativeiroEligibleCards', async (
    client, userId: number, opts: { limit?: number; offset?: number } = {},
  ) => {
    const { limit = 20, offset = 0 } = opts;
    const eligible = sql`${userCards.count} >= ${rarities.cativeiroThreshold}`;
    const where = and(eq(userCards.userId, userId), eligible);

    const [rows, total] = await Promise.all([
      client
        .select({
          id: cards.id,
          name: cards.name,
          imageUrl: cards.imageUrl,
          rarityName: rarities.name,
          rarityEmoji: rarities.emoji,
          subcategoryEmoji: sql<string | null>`COALESCE(${subcategories.emoji}, ${categories.emoji})`,
          subcategoryName: subcategories.name,
          ownedCount: userCards.count,
          customEmoji: userCards.customEmoji,
          customMediaUrl: userCards.customMediaUrl,
          customMediaType: userCards.customMediaType,
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
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .where(where)
        .then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total };
  })

  static setUserCardCustomEmoji = maybeTransaction('setUserCardCustomEmoji', async (client, userId: number, cardId: number, emoji: string) => {
    // eligibility folded into the WHERE - no check-then-write gap for a concurrent discard/trade.
    const [updated] = await client
      .update(userCards)
      .set({ customEmoji: emoji })
      .where(and(
        eq(userCards.userId, userId),
        eq(userCards.cardId, cardId),
        sql`${userCards.count} >= (SELECT ${rarities.cativeiroThreshold} FROM ${cards} INNER JOIN ${rarities} ON ${rarities.id} = ${cards.rarityId} WHERE ${cards.id} = ${cardId})`,
      ))
      .returning();
    return updated ? { ok: true as const, row: updated } : { ok: false as const, reason: 'not_eligible' as const };
  })

  static clearUserCardCustomEmoji = maybeTransaction('clearUserCardCustomEmoji', async (client, userId: number, cardId: number) => {
    const [updated] = await client
      .update(userCards)
      .set({ customEmoji: null })
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .returning();
    return updated ? { ok: true as const, row: updated } : { ok: false as const };
  })

  static createCativeiroSubmission = async (userId: number, cardId: number, mediaUrl: string, mediaType: 'photo' | 'video', submitter: CativeiroSubmitter) => {
    try {
      return { ok: true as const, submission: await CardsDB.createCativeiroSubmissionTx(userId, cardId, mediaUrl, mediaType, submitter) };
    } catch (e) {
      // drizzle-orm 0.45 wraps the raw pg error (with .code) as .cause.
      const code = (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === '23505') return { ok: false as const, reason: 'already_pending' as const };
      throw e;
    }
  }

  private static createCativeiroSubmissionTx = maybeTransaction('createCativeiroSubmission', async (
    client, userId: number, cardId: number, mediaUrl: string, mediaType: 'photo' | 'video', submitter: CativeiroSubmitter,
  ) => {
    return await client
      .insert(cardCustomizationSubmissions)
      .values({
        userId, cardId, mediaUrl, mediaType,
        submitterPlatform: submitter.platform,
        submitterPlatformId: submitter.platformId,
        submitterName: submitter.name,
        submitterChatId: submitter.chatId,
        submitterThreadId: submitter.threadId,
      })
      .returning()
      .then(a => a?.[0]);
  })

  static setCativeiroSubmissionReviewMessage = maybeTransaction('setCativeiroSubmissionReviewMessage', async (client, submissionId: number, reviewChatId: string, reviewMessageId: string) => {
    await client.update(cardCustomizationSubmissions).set({ reviewChatId, reviewMessageId }).where(eq(cardCustomizationSubmissions.id, submissionId));
  })

  // reviewer/reviewedAt aren't stored here - AuditDB.log('cativeiro.approve'/'reject') already has them.
  static approveCativeiroSubmission = maybeTransaction('approveCativeiroSubmission', async (client, submissionId: number) => {
    // re-checked here (not just at guard time) - the submission may have sat pending for
    // days while the user dropped below cativeiroThreshold. Folded into the WHERE for TOCTOU-safety.
    const stillEligible = sql`EXISTS (
      SELECT 1 FROM ${userCards}
      INNER JOIN ${cards} ON ${cards.id} = ${userCards.cardId}
      INNER JOIN ${rarities} ON ${rarities.id} = ${cards.rarityId}
      WHERE ${userCards.userId} = ${cardCustomizationSubmissions.userId}
        AND ${userCards.cardId} = ${cardCustomizationSubmissions.cardId}
        AND ${userCards.count} >= ${rarities.cativeiroThreshold}
    )`;

    const [submission] = await client
      .update(cardCustomizationSubmissions)
      .set({ status: 'approved' })
      .where(and(
        eq(cardCustomizationSubmissions.id, submissionId),
        eq(cardCustomizationSubmissions.status, 'pending'),
        stillEligible,
      ))
      .returning();

    if (submission) {
      await client
        .update(userCards)
        .set({ customMediaUrl: submission.mediaUrl, customMediaType: submission.mediaType })
        .where(and(eq(userCards.userId, submission.userId), eq(userCards.cardId, submission.cardId)));

      return { ok: true as const, submission };
    }

    const [current] = await client
      .select()
      .from(cardCustomizationSubmissions)
      .where(eq(cardCustomizationSubmissions.id, submissionId));
    if (!current || current.status !== 'pending') return { ok: false as const, reason: 'not_pending' as const };
    return { ok: false as const, reason: 'not_eligible' as const };
  })

  static rejectCativeiroSubmission = maybeTransaction('rejectCativeiroSubmission', async (client, submissionId: number) => {
    const [submission] = await client
      .update(cardCustomizationSubmissions)
      .set({ status: 'rejected' })
      .where(and(eq(cardCustomizationSubmissions.id, submissionId), eq(cardCustomizationSubmissions.status, 'pending')))
      .returning();
    return submission ? { ok: true as const, submission } : { ok: false as const, reason: 'not_pending' as const };
  })

  static getPendingCativeiroSubmissionForUser = maybeTransaction('getPendingCativeiroSubmissionForUser', async (client, userId: number) => {
    return await client
      .select()
      .from(cardCustomizationSubmissions)
      .where(and(eq(cardCustomizationSubmissions.userId, userId), eq(cardCustomizationSubmissions.status, 'pending')))
      .limit(1)
      .then(a => a?.[0]);
  })

  static cancelCativeiroSubmission = maybeTransaction('cancelCativeiroSubmission', async (client, submissionId: number, userId: number) => {
    const [submission] = await client
      .update(cardCustomizationSubmissions)
      .set({ status: 'cancelled' })
      .where(and(
        eq(cardCustomizationSubmissions.id, submissionId),
        eq(cardCustomizationSubmissions.userId, userId),
        eq(cardCustomizationSubmissions.status, 'pending'),
      ))
      .returning();
    return submission ? { ok: true as const, submission } : { ok: false as const, reason: 'not_pending' as const };
  })

  static updateRarity = maybeTransaction('updateRarity', async (client, id: number, data: Partial<typeof rarities.$inferInsert>) => {
    return await client.update(rarities).set(data).where(eq(rarities.id, id)).returning().then(a => a?.[0]);
  })

  static addToWishlist = maybeTransaction('addToWishlist', async (client, userId: number, cardId: number) => {
    const nextPosition = await client
      .select({ max: sql<number>`COALESCE(MAX(${wishlist.position}), -1) + 1` })
      .from(wishlist)
      .where(eq(wishlist.userId, userId))
      .then(a => a?.[0]?.max ?? 0);

    await client.insert(wishlist).values({ userId, cardId, position: nextPosition }).onConflictDoNothing();
  })

  static reorderWishlist = maybeTransaction('reorderWishlist', async (client, userId: number, orderedCardIds: number[]) => {
    for (let index = 0; index < orderedCardIds.length; index++) {
      await client.update(wishlist).set({ position: index }).where(and(eq(wishlist.userId, userId), eq(wishlist.cardId, orderedCardIds[index]!)))
    }
  })

  static removeFromWishlist = maybeTransaction('removeFromWishlist', async (client, userId: number, cardId: number) => {
    await client.delete(wishlist).where(and(eq(wishlist.userId, userId), eq(wishlist.cardId, cardId)));
  })

  static removeManyFromWishlist = maybeTransaction('removeManyFromWishlist', async (client, userId: number, cardIds: number[]) => {
    if (cardIds.length === 0) return [];
    const removed = await client
      .delete(wishlist)
      .where(and(eq(wishlist.userId, userId), inArray(wishlist.cardId, cardIds)))
      .returning({ cardId: wishlist.cardId });
    return removed.map(r => r.cardId);
  })

  static clearWishlist = maybeTransaction('clearWishlist', async (client, userId: number) => {
    await client.delete(wishlist).where(eq(wishlist.userId, userId));
  })

  static isOnWishlist = maybeTransaction('isOnWishlist', async (client, userId: number, cardId: number) => {
    return !!(await client
      .select()
      .from(wishlist)
      .where(and(eq(wishlist.userId, userId), eq(wishlist.cardId, cardId)))
      .limit(1)
      .then(a => a?.[0]));
  })

  static getWishlist = maybeTransaction('getWishlist', async (
    client, userId: number, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const { query, limit = 20, offset = 0 } = opts;
    const where = query
      ? and(eq(wishlist.userId, userId), ilike(cards.name, `%${query}%`))
      : eq(wishlist.userId, userId);

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
        })
        .from(wishlist)
        .innerJoin(cards, eq(cards.id, wishlist.cardId))
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .leftJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(where)
        .orderBy(wishlist.position, cards.id)
        .limit(limit)
        .offset(offset),
      client
        .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
        .from(wishlist)
        .innerJoin(cards, eq(cards.id, wishlist.cardId))
        .where(where)
        .then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total };
  })

  static isOnGoals = maybeTransaction('isOnGoals', async (client, userId: number, subcategoryId: number) => {
    return !!(await client
      .select()
      .from(subcategoryGoals)
      .where(and(eq(subcategoryGoals.userId, userId), eq(subcategoryGoals.subcategoryId, subcategoryId)))
      .limit(1)
      .then(a => a?.[0]));
  })

  static addToGoals = maybeTransaction('addToGoals', async (client, userId: number, subcategoryId: number) => {
    await client.insert(subcategoryGoals).values({ userId, subcategoryId }).onConflictDoNothing();
  })

  static removeFromGoals = maybeTransaction('removeFromGoals', async (client, userId: number, subcategoryId: number) => {
    await client.delete(subcategoryGoals).where(and(eq(subcategoryGoals.userId, userId), eq(subcategoryGoals.subcategoryId, subcategoryId)));
  })

  static getGoalSubcategoryIdsForUser = maybeTransaction('getGoalSubcategoryIdsForUser', async (client, userId: number) => {
    return await client
      .select({ subcategoryId: subcategoryGoals.subcategoryId, categoryId: subcategories.categoryId })
      .from(subcategoryGoals)
      .innerJoin(subcategories, eq(subcategories.id, subcategoryGoals.subcategoryId))
      .where(eq(subcategoryGoals.userId, userId));
  })

  static getGoals = maybeTransaction('getGoals', async (
    client, userId: number, opts: { limit?: number; offset?: number } = {},
  ) => {
    const { limit = 20, offset = 0 } = opts;
    const [rows, total] = await Promise.all([
      client
        .select({
          subcategoryId: subcategories.id,
          subcategoryName: subcategories.name,
          categoryName: categories.name,
          categoryEmoji: categories.emoji,
          imageUrl: subcategories.imageUrl,
        })
        .from(subcategoryGoals)
        .innerJoin(subcategories, eq(subcategories.id, subcategoryGoals.subcategoryId))
        .innerJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(eq(subcategoryGoals.userId, userId))
        .orderBy(subcategoryGoals.createdAt)
        .limit(limit)
        .offset(offset),
      client
        .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
        .from(subcategoryGoals)
        .where(eq(subcategoryGoals.userId, userId))
        .then(r => r[0]?.total ?? 0),
    ]);
    return { rows, total };
  })

  static getSubcategoriesByIds = maybeTransaction('getSubcategoriesByIds', async (client, ids: number[]) => {
    if (ids.length === 0) return [];
    return await client
      .select({ id: subcategories.id, name: subcategories.name, categoryEmoji: categories.emoji })
      .from(subcategories)
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(inArray(subcategories.id, ids));
  })

  static searchAllCardsPaginated = maybeTransaction('searchAllCardsPaginated', async (
    client, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const { query, limit = 20, offset = 0 } = opts;
    const where = query ? ilike(cards.name, `%${query}%`) : undefined;

    const [rows, total] = await Promise.all([
      client
        .select({
          id: cards.id,
          name: cards.name,
          imageUrl: cards.imageUrl,
          rarityName: rarities.name,
          rarityEmoji: rarities.emoji,
          subcategoryName: subcategories.name,
        })
        .from(cards)
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .where(where)
        .orderBy(cards.name, cards.id)
        .limit(limit)
        .offset(offset),
      client
        .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
        .from(cards)
        .where(where)
        .then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total };
  })

  static setCardTradable = maybeTransaction('setCardTradable', async (client, userId: number, cardId: number, tradable: boolean) => {
    return await client
      .update(userCards)
      .set({ tradable })
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .returning()
      .then(a => a?.[0]);
  })

  static isCardTradable = maybeTransaction('isCardTradable', async (client, userId: number, cardId: number) => {
    return await client
      .select({ tradable: userCards.tradable })
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1)
      .then(a => a?.[0]?.tradable ?? false);
  })

  static setAllUserCardsTradable = maybeTransaction('setAllUserCardsTradable', async (client, userId: number, tradable: boolean) => {
    const result = await client
      .update(userCards)
      .set({ tradable })
      .where(eq(userCards.userId, userId))
      .returning({ cardId: userCards.cardId })
    return result.length
  })

  // used by /trococat and /naotrococat, the collection-wide sibling of /troco and /naotroco.
  static setSubcategoryCardsTradable = maybeTransaction('setSubcategoryCardsTradable', async (client, userId: number, subcategoryId: number, tradable: boolean) => {
    const owned = await client
      .select({ cardId: userCards.cardId })
      .from(cardSubcategories)
      .innerJoin(userCards, and(eq(userCards.cardId, cardSubcategories.cardId), eq(userCards.userId, userId)))
      .where(eq(cardSubcategories.subcategoryId, subcategoryId))
    const cardIds = owned.map(o => o.cardId)
    if (cardIds.length === 0) return []

    const result = await client
      .update(userCards)
      .set({ tradable })
      .where(and(eq(userCards.userId, userId), inArray(userCards.cardId, cardIds)))
      .returning({ cardId: userCards.cardId })
    return result.map(r => r.cardId)
  })

  static getUserTradableCards = maybeTransaction('getUserTradableCards', async (client, userId: number) => {
    return await client
      .select({
        id: cards.id,
        name: cards.name,
        imageUrl: cards.imageUrl,
        rarityName: rarities.name,
        rarityEmoji: rarities.emoji,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
        subcategoryName: subcategories.name,
        ownedCount: userCards.count,
      })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .leftJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(and(eq(userCards.userId, userId), eq(userCards.tradable, true)))
      .orderBy(desc(cards.rarityId), cards.id);
  })

  static compareWishlists = maybeTransaction('compareWishlists', async (client, userId: number, otherUserId: number) => {
    const matchRow = (ownerId: number, wantsId: number) => client
      .select({
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
      .innerJoin(wishlist, and(eq(wishlist.cardId, userCards.cardId), eq(wishlist.userId, wantsId)))
      .where(and(eq(userCards.userId, ownerId), eq(userCards.tradable, true)))
      .orderBy(desc(cards.rarityId), cards.id);

    const [iHaveTheyWant, theyHaveIWant] = await Promise.all([
      matchRow(userId, otherUserId),
      matchRow(otherUserId, userId),
    ]);

    return { iHaveTheyWant, theyHaveIWant };
  })

  static getUserOwnedCardsBySubcategory = maybeTransaction('getUserOwnedCardsBySubcategory', async (
    client, userId: number, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const PREVIEW_CAP = 10;
    const { query, limit = 10, offset = 0 } = opts;
    const cardMatch = query ? ilike(cards.name, `%${query}%`) : undefined;
    // ownership is "physically owned OR currently auctioned by this user", so a card doesn't vanish while its /leiloar is live - requires starting FROM cards (left-joined to userCards) so a zero-userCards row still appears.
    const inAuctionExpr = sql`EXISTS (SELECT 1 FROM ${auctions} WHERE ${auctions.sellerId} = ${userId} AND ${auctions.cardId} = ${cards.id} AND ${auctions.status} = 'active')`;
    const ownedCondition = sql`(COALESCE(${userCards.count}, 0) > 0 OR ${inAuctionExpr})`;
    const where = cardMatch ? and(ownedCondition, cardMatch) : ownedCondition;

    const [subcategoryRows, totalSubcategories] = await Promise.all([
      client
        .select({
          subcategoryId: subcategories.id,
          subcategoryName: subcategories.name,
          categoryEmoji: categories.emoji,
          categoryName: categories.name,
          total: sql<number>`CAST(COUNT(*) AS INTEGER)`,
        })
        .from(cards)
        .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
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
        .from(cards)
        .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
        .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .where(where)
        .then(r => r[0]?.total ?? 0),
    ]);

    type CardRow = {
      subcategoryId: number; id: number; name: string; imageUrl: string | null;
      rarityName: string; rarityEmoji: string; ownedCount: number; tradable: boolean; inAuction: boolean;
    };
    const subcategoryIds = subcategoryRows.map(r => r.subcategoryId);
    const cardsBySubcategory = new Map<number, CardRow[]>();

    if (subcategoryIds.length > 0) {
      const cardWhere = cardMatch
        ? and(ownedCondition, inArray(subcategories.id, subcategoryIds), cardMatch)
        : and(ownedCondition, inArray(subcategories.id, subcategoryIds));

      const cardRows = await client
        .select({
          subcategoryId: subcategories.id,
          id: cards.id,
          name: cards.name,
          imageUrl: cards.imageUrl,
          rarityName: rarities.name,
          rarityEmoji: rarities.emoji,
          ownedCount: sql<number>`CAST(COALESCE(${userCards.count}, 0) AS INTEGER)`,
          tradable: sql<boolean>`COALESCE(${userCards.tradable}, false)`,
          inAuction: sql<boolean>`${inAuctionExpr}`,
        })
        .from(cards)
        .leftJoin(userCards, and(eq(userCards.cardId, cards.id), eq(userCards.userId, userId)))
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
    // same reasoning as getUserOwnedCardsBySubcategory - a card still counts as "owned" while auctioned, so a collection doesn't visibly regress just from listing one of its cards.
    const inAuctionExpr = sql`EXISTS (SELECT 1 FROM ${auctions} WHERE ${auctions.sellerId} = ${userId} AND ${auctions.cardId} = ${cardSubcategories.cardId} AND ${auctions.status} = 'active')`;
    const ownedExpr = sql`COUNT(DISTINCT CASE WHEN (${userCards.count} > 0 OR ${inAuctionExpr}) THEN ${cardSubcategories.cardId} END)`;
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
        isGoal: sql<boolean>`BOOL_OR(${subcategoryGoals.subcategoryId} IS NOT NULL)`,
      })
      .from(subcategories)
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .innerJoin(cardSubcategories, eq(cardSubcategories.subcategoryId, subcategories.id))
      .leftJoin(userCards, and(eq(userCards.cardId, cardSubcategories.cardId), eq(userCards.userId, userId)))
      .leftJoin(subcategoryGoals, and(eq(subcategoryGoals.subcategoryId, subcategories.id), eq(subcategoryGoals.userId, userId)))
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
      .innerJoin(cardSubcategories, eq(cardSubcategories.subcategoryId, subcategories.id))
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
      .innerJoin(cardSubcategories, eq(cardSubcategories.subcategoryId, subcategories.id))
      .leftJoin(userCards, and(eq(userCards.cardId, cardSubcategories.cardId), eq(userCards.userId, userId)))
      .groupBy(subcategories.id);

    return {
      completed: perSubcategory.filter(s => s.total > 0 && s.owned === s.total).length,
      total: perSubcategory.length,
    };
  })

  static discardUserCards = async (userId: number, cardIds: number[]) => {
    // fetched outside the tx, same rate-once-then-pass-in pattern as buyItem/purchaseItem
    const incomeInflationRate = await EconomyDB.getIncomeInflationRate();
    try {
      return await CardsDB.discardUserCardsTx(userId, cardIds, incomeInflationRate);
    } catch (e) {
      if (e instanceof InsufficientCardError) return { ok: false as const, reason: 'missing_or_not_owned' as const, cardId: e.cardId };
      throw e;
    }
  }

  private static discardUserCardsTx = maybeTransaction('discardUserCards', async (client, userId: number, cardIds: number[], incomeInflationRate: number) => {
    const requestedQty = new Map<number, number>();
    for (const id of cardIds) requestedQty.set(id, (requestedQty.get(id) ?? 0) + 1);
    const uniqueIds = [...requestedQty.keys()];
    if (uniqueIds.length === 0) return { ok: true as const, results: [], totalCoinsAwarded: 0 };

    const owned = await client
      .select({ cardId: userCards.cardId, count: userCards.count, rarityName: rarities.name, cativeiroThreshold: rarities.cativeiroThreshold })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(and(eq(userCards.userId, userId), inArray(userCards.cardId, uniqueIds)));

    const ownedById = new Map(owned.map(o => [o.cardId, o]));

    for (const [cardId, qty] of requestedQty) {
      const row = ownedById.get(cardId);
      if (!row || row.count < qty) return { ok: false as const, reason: 'missing_or_not_owned' as const, cardId };
    }

    const results: { cardId: number; remainingCount: number; coinsAwarded: number }[] = [];
    let totalCoinsAwarded = 0;

    for (const [cardId, qty] of requestedQty) {
      const row = ownedById.get(cardId)!;
      const reward = calculateCardDiscardReward(row.rarityName, qty, incomeInflationRate);

      const [updated] = await client
        .update(userCards)
        .set({ count: sql`${userCards.count} - ${qty}` })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId), gte(userCards.count, qty)))
        .returning();
      if (!updated) throw new InsufficientCardError(userId, cardId);

      if (updated.count === 0) {
        await client.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      } else if (updated.count < row.cativeiroThreshold) {
        // no longer eligible - clear any customization instead of leaving it dangling.
        await client
          .update(userCards)
          .set({ customEmoji: null, customMediaUrl: null, customMediaType: null })
          .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      }

      results.push({ cardId, remainingCount: updated.count, coinsAwarded: reward });
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
          emoji: subcategories.emoji,
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
