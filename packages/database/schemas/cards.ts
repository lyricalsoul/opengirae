import { users } from "./users";
import {
  integer,
  pgTable,
  text,
  timestamp,
  boolean,
  doublePrecision,
  primaryKey,
} from "drizzle-orm/pg-core";

/// The rarity a card can have. Usually Common, Rare, Legendary, Mythic
export const rarities = pgTable("rarities", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull().unique(),
  chance: doublePrecision().notNull(),
  emoji: text().notNull(),
});

/// The category which cards and items may belong.
export const categories = pgTable("categories", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull().unique(),
  emoji: text().notNull(),
  subcategoriesOnDraw: integer().notNull().default(4),
  isHidden: boolean().notNull().default(false),
  drawImageUrl: text(),
});

export const subcategories = pgTable("subcategories", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  categoryId: integer()
    .notNull()
    .references(() => categories.id),
  name: text().notNull(),
  rarityModifier: doublePrecision().notNull().default(1),
  tags: text().array(),
  isSecondary: boolean().notNull().default(false),
  imageUrl: text(),
});

export const cards = pgTable("cards", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  rarityId: integer()
    .notNull()
    .references(() => rarities.id),
  subcategoryId: integer()
    .notNull()
    .references(() => subcategories.id),
  imageUrl: text(),
  updatedAt: timestamp().notNull().defaultNow(),
  rarityModifier: doublePrecision().notNull().default(1),
});

export const cardSubcategories = pgTable(
  "card_subcategories",
  {
    cardId: integer()
      .notNull()
      .references(() => cards.id),
    subcategoryId: integer()
      .notNull()
      .references(() => subcategories.id),
  },
  (table) => [primaryKey({ columns: [table.cardId, table.subcategoryId] })],
);

export const userCards = pgTable(
  "user_cards",
  {
    userId: integer()
      .notNull()
      .references(() => users.id),
    cardId: integer()
      .notNull()
      .references(() => cards.id),
    count: integer().notNull().default(1),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.cardId] })],
);
