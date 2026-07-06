import { db } from "./index";
import {
  cards,
  categories,
  subcategories,
  rarities,
  userCards,
} from "./schemas/cards";
import { eq, and, sql } from "drizzle-orm";

export const getCategory = async (id: number) => {
  return await db
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
};

export const getSubcategory = async (id: number) => {
  return await db
    .select()
    .from(subcategories)
    .where(eq(subcategories.id, id))
    .limit(1);
};

export const getRarity = async (id: number) => {
  return await db.select().from(rarities).where(eq(rarities.id, id)).limit(1);
};

export const getCard = async (id: number) => {
  return await db.select().from(cards).where(eq(cards.id, id)).limit(1);
};

export const createCategory = async (name: string) => {
  return await db.insert(categories).values({ name, emoji: "🏷️" }).returning();
};

export const createSubcategory = async (name: string, categoryId: number) => {
  return await db
    .insert(subcategories)
    .values({ name, categoryId })
    .returning();
};

export const createRarity = async (
  name: string,
  emoji: string,
  chance: number,
) => {
  return await db.insert(rarities).values({ name, emoji, chance }).returning();
};

export const createCard = async (
  name: string,
  rarityId: number,
  subcategoryId: number,
) => {
  return await db
    .insert(cards)
    .values({ name, rarityId, subcategoryId })
    .returning();
};

export const getUserCard = async (userId: number, cardId: number) => {
  return await db
    .select()
    .from(userCards)
    .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
    .limit(1)
    .then((a) => a?.[0]);
};

export const hasUserCard = async (userId: number, cardId: number) => {
  return !!(await getUserCard(userId, cardId));
};

export const addUserCard = async (userId: number, cardId: number) => {
  if (await hasUserCard(userId, cardId)) {
    return await db
      .update(userCards)
      .set({ count: sql`${userCards.count} + 1` })
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      .returning();
  }

  return await db.insert(userCards).values({ userId, cardId }).returning();
};

export const getCategories = async () => {
  return await db
    .select()
    .from(categories)
}

export const getSubcategoriesForCategory = async (categoryId: number) => {
  return await db
    .select()
    .from(subcategories)
    .where(eq(subcategories.categoryId, categoryId))
}

export const getSubcategoriesForCategoryDraw = async (categoryId: number) => {
}

