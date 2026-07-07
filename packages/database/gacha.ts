import { dataSource } from "./index";
import { cards, subcategories, rarities, cardSubcategories } from "./schemas/cards";
import { eq } from "drizzle-orm";

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

  @dataSource.transaction()
  static async getSubcategoriesForDraw(categoryId: number): Promise<SubcategoryForDraw[]> {
    return await dataSource.client
      .select({
        id: subcategories.id,
        name: subcategories.name,
        rarityModifier: subcategories.rarityModifier
      })
      .from(subcategories)
      .where(eq(subcategories.categoryId, categoryId));
  }

  @dataSource.transaction()
  static async getCardsForDraw(subcategoryId: number): Promise<CardForDraw[]> {
    return await dataSource.client
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
  }
}
