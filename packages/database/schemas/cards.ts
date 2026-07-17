import { users } from "./users";
import {
  integer,
  pgTable,
  text,
  timestamp,
  boolean,
  doublePrecision,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

/// The rarity a card can have. Usually Common, Rare, Legendary
export const rarities = pgTable("rarities", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull().unique(),
  weight: integer().notNull(),
  emoji: text().notNull(),
});

/// The category which cards and items may belong to.
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
  tags: text().array(),
  aliases: text().array(),
  isSecondary: boolean().notNull().default(false),
  imageUrl: text(),

  rarityModifier: integer().notNull().default(100),
});

export const cards = pgTable("cards", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  rarityId: integer()
    .notNull()
    .references(() => rarities.id),
  imageUrl: text(),
  updatedAt: timestamp().notNull().defaultNow(),

  rarityModifier: integer().notNull().default(100),
});

export const cardSubcategories = pgTable(
  "card_subcategories",
  {
    cardId: integer()
      .notNull()
      .references(() => cards.id),
    subcategoryId: integer()
      .notNull()
      .references(() => subcategories.id, { onDelete: "cascade" }),
    isMain: boolean().notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.subcategoryId] }),
    index("card_subcategories_sub_idx").on(table.subcategoryId),
  ],
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

export const cardDrawHistory = pgTable("card_draw_history", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id),
  cardId: integer().notNull().references(() => cards.id),
  categoryId: integer().notNull().references(() => categories.id),
  subcategoryId: integer().notNull().references(() => subcategories.id, { onDelete: "cascade" }),
  drawnAt: timestamp().notNull().defaultNow(),
});

export const chocolateFactoryCorrections = pgTable("chocolate_factory_corrections", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  targetName: text().notNull().unique(),
  subcategoryId: integer().notNull().references(() => subcategories.id, { onDelete: "cascade" }),
});

export const trades = pgTable("trades", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  user1Id: integer().notNull().references(() => users.id),
  user2Id: integer().notNull().references(() => users.id),
  cardsUser1: integer().array().notNull(),
  cardsUser2: integer().array().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});
