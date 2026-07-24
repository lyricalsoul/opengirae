import { maybeTransaction } from "./decorators";
import { cards, categories, subcategories, rarities, cardSubcategories, userCards, cardDrawHistory } from "./schemas/cards";
import { users } from "./schemas/users";
import { eq, and, sql, inArray } from "drizzle-orm";

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
}

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

  static selectCard(pool: CardForDraw[]): CardForDraw | undefined {
    if (pool.length === 0) return undefined;

    let totalWeight = 0;
    const weights = pool.map(card => {
      const weight = card.rarityWeight * (card.rarityModifier / 100);
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
      .where(eq(subcategories.categoryId, categoryId));
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
      })
      .from(cards)
      .innerJoin(cardSubcategories, eq(cardSubcategories.cardId, cards.id))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(eq(cardSubcategories.subcategoryId, subcategoryId));
  })

  static runBulkDraws = maybeTransaction('runBulkDraws', async (
    client,
    userId: number,
    categoryOrder: number[],
    luckModifier: number,
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
      .where(inArray(subcategories.categoryId, distinctCategoryIds));
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
      const drawnCard = GachaLogic.selectCard(cardPool);
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

    // read pre-update counts up front (one bulk query, not N+1) so we can report which
    // cards crossed their cativeiro threshold in this batch - the upsert below only ever
    // returns post-update state.
    const existingCounts = await client
      .select({ cardId: userCards.cardId, count: userCards.count })
      .from(userCards)
      .where(and(eq(userCards.userId, userId), inArray(userCards.cardId, drawnCardIds)));
    const previousCountByCard = new Map(existingCounts.map(r => [r.cardId, r.count]));

    await client
      .insert(userCards)
      .values([...countByCard.entries()].map(([cardId, count]) => ({ userId, cardId, count })))
      .onConflictDoUpdate({
        target: [userCards.userId, userCards.cardId],
        set: { count: sql`${userCards.count} + excluded.${sql.identifier(userCards.count.name)}` },
      });

    await client.insert(cardDrawHistory).values(
      results.map(r => ({ userId, cardId: r.card.id, categoryId: r.categoryId, subcategoryId: r.subcategoryId }))
    );

    await client.update(users).set({ usedDraws: sql`${users.usedDraws} + ${results.length}` }).where(eq(users.id, userId));

    const countsByCard: CardCountCrossing[] = [...countByCard.entries()].map(([cardId, drawnCount]) => {
      const previousCount = previousCountByCard.get(cardId) ?? 0;
      return { cardId, previousCount, newCount: previousCount + drawnCount };
    });

    return { draws: results, countsByCard };
  })
}
