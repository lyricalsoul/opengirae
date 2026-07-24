import { users } from "./users";
import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  text,
  timestamp,
  boolean,
  doublePrecision,
  primaryKey,
  index,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/// The rarity a card can have. Usually Common, Rare, Legendary
export const rarities = pgTable("rarities", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull().unique(),
  weight: integer().notNull(),
  emoji: text().notNull(),

  // admin-configurable "own this many copies of one card" unlock for cativeiro customization
  cativeiroThreshold: integer().notNull().default(15),
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
  // shown next to cativeiro listings/alerts; falls back to the category's emoji when unset
  emoji: text(),

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

export const cativeiroMediaType = pgEnum("cativeiro_media_type", ["photo", "video"])

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
    tradable: boolean().notNull().default(false),
    updatedAt: timestamp().notNull().defaultNow(),

    // cativeiro customization - set once the owner unlocks it (see rarities.cativeiroThreshold)
    customEmoji: text(),
    customMediaUrl: text(),
    customMediaType: cativeiroMediaType(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.cardId] })],
);

export const cativeiroSubmissionStatus = pgEnum("cativeiro_submission_status", ["pending", "approved", "rejected"])

// pending-review queue for /upload's media customizations - kept separate from userCards'
// current-customization columns since a submission has its own lifecycle/history.
export const cardCustomizationSubmissions = pgTable(
  "card_customization_submissions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer().notNull().references(() => users.id),
    cardId: integer().notNull().references(() => cards.id),
    mediaUrl: text().notNull(),
    mediaType: cativeiroMediaType().notNull(),
    status: cativeiroSubmissionStatus().notNull().default("pending"),

    // denormalized submitter context - staff may review this long after the
    // submitting request/workflow (if any) has ended, so we can't rely on
    // re-deriving "where to reply" from anything else at review time.
    submitterPlatform: text().notNull(),
    submitterPlatformId: text().notNull(),
    submitterName: text().notNull(),
    submitterChatId: text().notNull(),
    submitterThreadId: text(),

    // the review-topic message this submission was posted as - so approve/reject can
    // delete it and post a fresh decision message in the same topic.
    reviewChatId: text(),
    reviewMessageId: text(),

    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    // at most one pending submission per (user, card) at a time - the actual TOCTOU-safe
    // guard (checked via a 23505 catch in CardsDB.createCativeiroSubmission), not just an
    // app-level check-then-insert.
    uniqueIndex("card_customization_submissions_pending_unique")
      .on(table.userId, table.cardId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const wishlist = pgTable(
  "wishlist",
  {
    userId: integer()
      .notNull()
      .references(() => users.id),
    cardId: integer()
      .notNull()
      .references(() => cards.id),
    position: integer().notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.cardId] }),
    index("wishlist_card_idx").on(table.cardId),
  ],
);

export const subcategoryGoals = pgTable(
  "subcategory_goals",
  {
    userId: integer()
      .notNull()
      .references(() => users.id),
    subcategoryId: integer()
      .notNull()
      .references(() => subcategories.id, { onDelete: "cascade" }),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.subcategoryId] }),
    index("subcategory_goals_sub_idx").on(table.subcategoryId),
  ],
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
