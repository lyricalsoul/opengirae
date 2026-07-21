import { maybeTransaction } from "./decorators";
import { cards, categories, subcategories, rarities, cardSubcategories, userCards, cardDrawHistory } from "./schemas/cards";
import { users } from "./schemas/users";
import { eq, and, sql } from "drizzle-orm";

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
  ): Promise<BulkDrawResult[]> => {
    const results: BulkDrawResult[] = [];

    for (const categoryId of categoryOrder) {
      const category = await client
        .select({ name: categories.name, emoji: categories.emoji, subcategoriesOnDraw: categories.subcategoriesOnDraw })
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1)
        .then(a => a?.[0]);
      if (!category) continue;

      const subcategoriesForDraw = await client
        .select({ id: subcategories.id, name: subcategories.name, rarityModifier: subcategories.rarityModifier })
        .from(subcategories)
        .where(eq(subcategories.categoryId, categoryId));
      if (subcategoriesForDraw.length === 0) continue;

      const rolled = GachaLogic.selectSubcategories(subcategoriesForDraw, category.subcategoriesOnDraw, luckModifier);
      if (rolled.length === 0) continue;

      const favoritesRolled = favoriteSubcategoryIds
        ? rolled.filter(s => favoriteSubcategoryIds.has(s.id))
        : [];
      const candidatePool = favoritesRolled.length > 0 ? favoritesRolled : rolled;
      const chosenSubcategory = GachaLogic.selectSubcategories(candidatePool, 1, luckModifier)[0];
      if (!chosenSubcategory) continue;

      const cardPool = await client
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
        .where(eq(cardSubcategories.subcategoryId, chosenSubcategory.id));
      const drawnCard = GachaLogic.selectCard(cardPool);
      if (!drawnCard) continue;

      const existingUserCard = await client
        .select()
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, drawnCard.id)))
        .limit(1)
        .then(a => a?.[0]);
      if (existingUserCard) {
        await client
          .update(userCards)
          .set({ count: sql`${userCards.count} + 1` })
          .where(and(eq(userCards.userId, userId), eq(userCards.cardId, drawnCard.id)));
      } else {
        await client.insert(userCards).values({ userId, cardId: drawnCard.id, count: 1 });
      }

      await client.insert(cardDrawHistory).values({
        userId, cardId: drawnCard.id, categoryId, subcategoryId: chosenSubcategory.id,
      });
      await client.update(users).set({ usedDraws: sql`${users.usedDraws} + 1` }).where(eq(users.id, userId));

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

    return results;
  })
}
