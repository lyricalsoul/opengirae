import { dataSource } from "./index";
import {
  cards,
  categories,
  subcategories,
  rarities,
  userCards,
  cardDrawHistory,
  cardSubcategories
} from "./schemas/cards";
import { eq, and, sql } from "drizzle-orm";

export class CardsDB {
  @dataSource.transaction()
  static async getCategory(id: number) {
    return await dataSource.client
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1)
      .then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async getSubcategory(id: number) {
    return await dataSource.client
      .select()
      .from(subcategories)
      .where(eq(subcategories.id, id))
      .limit(1)
      .then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async getRarity(id: number) {
    return await dataSource.client.select().from(rarities).where(eq(rarities.id, id)).limit(1).then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async getCard(id: number) {
    return await dataSource.client.select().from(cards).where(eq(cards.id, id)).limit(1).then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async getCardWithDetails(id: number) {
    return await dataSource.client
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
  }

  @dataSource.transaction()
  static async createCategory(name: string) {
    return await dataSource.client.insert(categories).values({ name, emoji: "🏷️" }).returning().then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async createSubcategory(name: string, categoryId: number) {
    return await dataSource.client
      .insert(subcategories)
      .values({ name, categoryId })
      .returning()
      .then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async createRarity(
    name: string,
    emoji: string,
    weight: number,
  ) {
    return await dataSource.client.insert(rarities).values({ name, emoji, weight }).returning().then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async createCard(
    name: string,
    rarityId: number,
    subcategoryId: number,
  ) {
    // TODO: implement
  }

  @dataSource.transaction()
  static async getUserCard(userId: number, cardId: number) {
    return await dataSource.client
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1)
      .then((a) => a?.[0]);
  }

  @dataSource.transaction()
  static async hasUserCard(userId: number, cardId: number) {
    return !!(await dataSource.client
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1)
      .then((a) => a?.[0]));
  }

  // TODO: would be cleaner as a raw SQL query
  @dataSource.transaction()
  static async addUserCard(userId: number, cardId: number) {
    const existing = await dataSource.client
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .limit(1)
      .then((a) => a?.[0]);

    if (existing) {
      return await dataSource.client
        .update(userCards)
        .set({ count: sql`${userCards.count} + 1` })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
        .returning()
        .then(a => a?.[0]);
    }

    return await dataSource.client.insert(userCards).values({ userId, cardId }).returning().then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async addCardDrawHistory(userId: number, cardId: number, categoryId: number, subcategoryId: number) {
    return await dataSource.client.insert(cardDrawHistory).values({ userId, cardId, categoryId, subcategoryId }).returning().then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async getCategories() {
    return await dataSource.client
      .select()
      .from(categories)
  }

  @dataSource.transaction()
  static async getSubcategoriesForCategory(categoryId: number) {
    return await dataSource.client
      .select()
      .from(subcategories)
      .where(eq(subcategories.categoryId, categoryId))
  }

  @dataSource.transaction()
  static async getUserCardsCount(userId: number): Promise<number> {
    const result = await dataSource.client
      .select({ total: sql<number>`CAST(COALESCE(SUM(${userCards.count}), 0) AS INTEGER)` })
      .from(userCards)
      .where(eq(userCards.userId, userId))
      .then(a => a?.[0]);
    return result?.total ?? 0;
  }
}
