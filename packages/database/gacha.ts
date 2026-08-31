import { maybeTransaction } from "./decorators";
import { cards, categories, subcategories, rarities, cardSubcategories, userCards, cardDrawHistory } from "./schemas/cards";
import { discotecaSubcategories, discotecaEntries, discotecaEntrySubcategories } from "./schemas/discoteca";
import { users } from "./schemas/users";
import { eq, and, sql, inArray } from "drizzle-orm";
import { CardsDB, type CompletedSubcategory } from "./cards";

export interface SubcategoryForDraw {
  id: number;
  name: string;
  rarityModifier: number;
}

export interface CardForDraw {
  id: number;
  name: string;
  rarityModifier: number;
  rarityWeight: number;
  rarityEmoji: string;
  imageUrl: string | null;
  rank: number;
}

export interface BulkDrawResult {
  card: CardForDraw;
  categoryId: number;
  categoryName: string;
  categoryEmoji: string;
  subcategoryId: number;
  subcategoryName: string;
  isFromFavorite: boolean;
}

export interface CardCountCrossing {
  cardId: number;
  previousCount: number;
  newCount: number;
  completedSubcategories?: CompletedSubcategory[];
}

const RARITY_RANK_SQL = sql<number>`(SELECT COUNT(*)::int FROM rarities AS r2 WHERE r2.weight > ${rarities.weight})`;

export class GachaLogic {
  static selectSubcategories(
    subs: SubcategoryForDraw[],
    count: number,
    luckModifier: number
  ): SubcategoryForDraw[] {
    const selected: SubcategoryForDraw[] = [];
    const pool = [...subs];

    while (selected.length < count && pool.length > 0) {
      let totalWeight = 0;
      const weights = pool.map(sub => {
        let weight = sub.rarityModifier;
        if (weight < 100) {
          weight = weight * (luckModifier / 100);
        }
        totalWeight += weight;
        return weight;
      });

      const r = Math.random() * totalWeight;
      let cumulativeSum = 0;
      let selectedIndex = -1;

      for (let i = 0; i < pool.length; i++) {
        cumulativeSum += weights[i]!;
        if (cumulativeSum >= r) {
          selectedIndex = i;
          break;
        }
      }

      if (selectedIndex === -1) {
        selectedIndex = pool.length - 1;
      }

      selected.push(pool[selectedIndex]!);
      pool.splice(selectedIndex, 1);
    }

    return selected;
  }

  static selectCard(pool: CardForDraw[], luckModifier: number): CardForDraw | undefined {
    if (pool.length === 0) return undefined;

    // dividing by tier size keeps a rarity's total pull-weight fixed regardless of how many cards are catalogued at it.
    const countByRank = new Map<number, number>();
    for (const c of pool) countByRank.set(c.rank, (countByRank.get(c.rank) ?? 0) + 1);

    let totalWeight = 0;
    const weights = pool.map(card => {
      const tierSize = countByRank.get(card.rank) ?? 1;
      const weight = (card.rarityWeight / tierSize) * (card.rarityModifier / 100) * Math.pow(luckModifier / 100, card.rank);
      totalWeight += weight;
      return weight;
    });

    if (totalWeight <= 0) return undefined;

    const r = Math.random() * totalWeight;
    let cumulativeSum = 0;
    let selectedIndex = -1;

    for (let i = 0; i < pool.length; i++) {
      cumulativeSum += weights[i]!;
      if (cumulativeSum >= r) {
        selectedIndex = i;
        break;
      }
    }

    if (selectedIndex === -1) {
      selectedIndex = pool.length - 1;
    }

    return pool[selectedIndex]!;
  }

  static getSubcategoriesForDraw = maybeTransaction('getSubcategoriesForDraw', async (client, categoryId: number): Promise<SubcategoryForDraw[]> => {
    return await client
      .select({
        id: subcategories.id,
        name: subcategories.name,
        rarityModifier: subcategories.rarityModifier
      })
      .from(subcategories)
      // secondary subcategories are tags for card lookup/filtering, not real drawable collections - see CardsDB.getSubcategoriesWithCardCounts
      .where(and(eq(subcategories.categoryId, categoryId), eq(subcategories.isSecondary, false)));
  })

  static getCardsForDraw = maybeTransaction('getCardsForDraw', async (client, subcategoryId: number): Promise<CardForDraw[]> => {
    return await client
      .select({
        id: cards.id,
        name: cards.name,
        rarityModifier: cards.rarityModifier,
        rarityWeight: rarities.weight,
        rarityEmoji: rarities.emoji,
        imageUrl: cards.imageUrl,
        rank: RARITY_RANK_SQL,
      })
      .from(cards)
      .innerJoin(cardSubcategories, eq(cardSubcategories.cardId, cards.id))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(eq(cardSubcategories.subcategoryId, subcategoryId));
  })

  static getDiscotecaSubcategoriesForDraw = maybeTransaction('getDiscotecaSubcategoriesForDraw', async (client, isAlbum: boolean): Promise<SubcategoryForDraw[]> => {
    return await client
      .select({
        id: discotecaSubcategories.id,
        name: discotecaSubcategories.name,
        rarityModifier: discotecaSubcategories.rarityModifier,
      })
      .from(discotecaSubcategories)
      .where(and(
        eq(discotecaSubcategories.isAlbum, isAlbum),
        sql`EXISTS (SELECT 1 FROM discoteca_entry_subcategories des WHERE des."subcategoryId" = ${discotecaSubcategories.id})`,
      ));
  })

  static getDiscotecaEntriesForDraw = maybeTransaction('getDiscotecaEntriesForDraw', async (client, subcategoryId: number): Promise<CardForDraw[]> => {
    return await client
      .select({
        id: discotecaEntries.id,
        name: discotecaEntries.name,
        rarityModifier: discotecaEntries.rarityModifier,
        rarityWeight: rarities.weight,
        rarityEmoji: rarities.emoji,
        imageUrl: discotecaEntries.artworkUrl,
        rank: RARITY_RANK_SQL,
      })
      .from(discotecaEntrySubcategories)
      .innerJoin(discotecaEntries, eq(discotecaEntries.id, discotecaEntrySubcategories.entryId))
      .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
      .where(eq(discotecaEntrySubcategories.subcategoryId, subcategoryId));
  })

  static runBulkDraws = maybeTransaction('runBulkDraws', async (
    client,
    userId: number,
    categoryOrder: number[],
    luckModifier: number,
    incomeInflationRate: number,
    favoriteSubcategoryIds?: Set<number>,
  ): Promise<{ draws: BulkDrawResult[]; countsByCard: CardCountCrossing[] }> => {
    const distinctCategoryIds = [...new Set(categoryOrder)];
    if (distinctCategoryIds.length === 0) return { draws: [], countsByCard: [] };

    const categoryRows = await client
      .select({ id: categories.id, name: categories.name, emoji: categories.emoji, subcategoriesOnDraw: categories.subcategoriesOnDraw })
      .from(categories)
      .where(inArray(categories.id, distinctCategoryIds));
    const categoriesById = new Map(categoryRows.map(c => [c.id, c]));

    const subcategoryRows = await client
      .select({ id: subcategories.id, name: subcategories.name, rarityModifier: subcategories.rarityModifier, categoryId: subcategories.categoryId })
      .from(subcategories)
      // secondary subcategories are tags for card lookup/filtering, not real drawable collections - see getSubcategoriesForDraw
      .where(and(inArray(subcategories.categoryId, distinctCategoryIds), eq(subcategories.isSecondary, false)));
    const subcategoriesByCategory = new Map<number, SubcategoryForDraw[]>();
    for (const { categoryId, ...sub } of subcategoryRows) {
      const list = subcategoriesByCategory.get(categoryId) ?? [];
      list.push(sub);
      subcategoriesByCategory.set(categoryId, list);
    }

    const allSubcategoryIds = subcategoryRows.map(s => s.id);
    const cardRows = allSubcategoryIds.length === 0 ? [] : await client
      .select({
        subcategoryId: cardSubcategories.subcategoryId,
        id: cards.id,
        name: cards.name,
        rarityModifier: cards.rarityModifier,
        rarityWeight: rarities.weight,
        rarityEmoji: rarities.emoji,
        imageUrl: cards.imageUrl,
        rank: RARITY_RANK_SQL,
      })
      .from(cardSubcategories)
      .innerJoin(cards, eq(cards.id, cardSubcategories.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(inArray(cardSubcategories.subcategoryId, allSubcategoryIds));
    const cardPoolBySubcategory = new Map<number, CardForDraw[]>();
    for (const { subcategoryId, ...card } of cardRows) {
      const list = cardPoolBySubcategory.get(subcategoryId) ?? [];
      list.push(card);
      cardPoolBySubcategory.set(subcategoryId, list);
    }

    const results: BulkDrawResult[] = [];

    for (const categoryId of categoryOrder) {
      const category = categoriesById.get(categoryId);
      if (!category) continue;

      const subcategoriesForDraw = subcategoriesByCategory.get(categoryId) ?? [];
      if (subcategoriesForDraw.length === 0) continue;

      const rolled = GachaLogic.selectSubcategories(subcategoriesForDraw, category.subcategoriesOnDraw, luckModifier);
      if (rolled.length === 0) continue;

      const favoritesRolled = favoriteSubcategoryIds
        ? rolled.filter(s => favoriteSubcategoryIds.has(s.id))
        : [];
      const candidatePool = favoritesRolled.length > 0 ? favoritesRolled : rolled;
      const chosenSubcategory = GachaLogic.selectSubcategories(candidatePool, 1, luckModifier)[0];
      if (!chosenSubcategory) continue;

      const cardPool = cardPoolBySubcategory.get(chosenSubcategory.id) ?? [];
      const drawnCard = GachaLogic.selectCard(cardPool, luckModifier);
      if (!drawnCard) continue;

      results.push({
        card: drawnCard,
        categoryId,
        categoryName: category.name,
        categoryEmoji: category.emoji,
        subcategoryId: chosenSubcategory.id,
        subcategoryName: chosenSubcategory.name,
        isFromFavorite: favoritesRolled.length > 0,
      });
    }

    if (results.length === 0) return { draws: results, countsByCard: [] };

    const countByCard = new Map<number, number>();
    for (const r of results) countByCard.set(r.card.id, (countByCard.get(r.card.id) ?? 0) + 1);
    const drawnCardIds = [...countByCard.keys()];

    // real main subcategory for display
    const mainSubcategoryRows = await client
      .select({ cardId: cardSubcategories.cardId, name: subcategories.name })
      .from(cardSubcategories)
      .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .where(and(inArray(cardSubcategories.cardId, drawnCardIds), eq(cardSubcategories.isMain, true)));
    const mainSubcategoryNameByCard = new Map(mainSubcategoryRows.map(r => [r.cardId, r.name]));
    for (const r of results) r.subcategoryName = mainSubcategoryNameByCard.get(r.card.id) ?? r.subcategoryName;

    // bulk pre-update counts, since the upsert below only returns post-update state.
    const existingCounts = await client
      .select({ cardId: userCards.cardId, count: userCards.count })
      .from(userCards)
      .where(and(eq(userCards.userId, userId), inArray(userCards.cardId, drawnCardIds)));
    const previousCountByCard = new Map(existingCounts.map(r => [r.cardId, r.count]));

    // only applies on insert - onConflictDoUpdate's set doesn't touch tradable, so existing cards keep their flag.
    const drawingUser = await client
      .select({ makeCardsTradeableByDefault: users.makeCardsTradeableByDefault })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then(a => a?.[0]);
    const defaultTradable = drawingUser?.makeCardsTradeableByDefault ?? false;

    await client
      .insert(userCards)
      .values([...countByCard.entries()].map(([cardId, count]) => ({ userId, cardId, count, tradable: defaultTradable })))
      .onConflictDoUpdate({
        target: [userCards.userId, userCards.cardId],
        set: { count: sql`${userCards.count} + excluded.${sql.identifier(userCards.count.name)}` },
      });

    await client.insert(cardDrawHistory).values(
      results.map(r => ({ userId, cardId: r.card.id, categoryId: r.categoryId, subcategoryId: r.subcategoryId }))
    );

    await client.update(users).set({ usedDraws: sql`${users.usedDraws} + ${results.length}` }).where(eq(users.id, userId));

    const completionsByCard = await CardsDB.claimCompletionsForCardsGainBatch(client, userId, drawnCardIds, incomeInflationRate);
    const countsByCard: CardCountCrossing[] = [...countByCard.entries()].map(([cardId, drawnCount]) => ({
      cardId,
      previousCount: previousCountByCard.get(cardId) ?? 0,
      newCount: (previousCountByCard.get(cardId) ?? 0) + drawnCount,
      completedSubcategories: completionsByCard.get(cardId) ?? [],
    }))

    return { draws: results, countsByCard };
  })
}
