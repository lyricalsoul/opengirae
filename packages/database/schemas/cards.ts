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

  // reference value (at economy.inflationRate = 1) used to price a /leilao listing for this
  // rarity - deliberately not admin-editable via its own UI/command, scales with inflationRate
  // instead. Seeded by migration, not this default - see AuctionsDB.
  auctionBaseValue: integer().notNull().default(0),
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

export const subcategories = pgTable(
  "subcategories",
  {
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

    createdAt: timestamp().notNull().defaultNow(),
    // set once the new-content cron has posted about this subcategory - see CardsDB.claimUnannouncedSubcategories
    announcedAt: timestamp(),
  },
  (table) => [
    // every /girar draw filters subcategories by categoryId
    index("subcategories_category_idx").on(table.categoryId),
    index("subcategories_name_unaccent_trgm_idx").using("gin", sql`immutable_unaccent(${table.name}) gin_trgm_ops`),
  ],
);

export const cards = pgTable(
  "cards",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    rarityId: integer()
      .notNull()
      .references(() => rarities.id),
    imageUrl: text(),
    aliases: text().array(),
    updatedAt: timestamp().notNull().defaultNow(),

    rarityModifier: integer().notNull().default(100),

    createdAt: timestamp().notNull().defaultNow(),
    // set once the new-content cron has posted about this card - see CardsDB.claimUnannouncedCards
    announcedAt: timestamp(),
  },
  (table) => [
    // ilike(name, '%query%') needs pg_trgm's operator class, a plain btree can't do it
    index("cards_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
    index("cards_name_unaccent_trgm_idx").using("gin", sql`immutable_unaccent(${table.name}) gin_trgm_ops`),
  ],
);

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
  (table) => [
    primaryKey({ columns: [table.userId, table.cardId] }),
    // the (userId, cardId) PK can't serve a cardId-only lookup/join, was seq-scanning
    index("user_cards_card_idx").on(table.cardId),
  ],
);

export const cativeiroSubmissionStatus = pgEnum("cativeiro_submission_status", ["pending", "approved", "rejected", "cancelled"])

// pending-review queue for /upload's media customizations - has its own lifecycle/history.
export const cardCustomizationSubmissions = pgTable(
  "card_customization_submissions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer().notNull().references(() => users.id),
    cardId: integer().notNull().references(() => cards.id),
    mediaUrl: text().notNull(),
    mediaType: cativeiroMediaType().notNull(),
    status: cativeiroSubmissionStatus().notNull().default("pending"),

    // denormalized submitter context - staff may review this long after the request ended.
    submitterPlatform: text().notNull(),
    submitterPlatformId: text().notNull(),
    submitterName: text().notNull(),
    submitterChatId: text().notNull(),
    submitterThreadId: text(),

    // the review-topic message this was posted as, so approve/reject can replace it.
    reviewChatId: text(),
    reviewMessageId: text(),

    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    // at most one pending submission per (user, card) - the real TOCTOU-safe guard.
    uniqueIndex("card_customization_submissions_pending_unique")
      .on(table.userId, table.cardId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const hipotecaSessions = pgTable(
  "hipoteca_sessions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer().notNull().references(() => users.id),
    staffId: integer().notNull().references(() => users.id),
    savedLuckModifier: integer().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    // a session row's existence is the "on hold" flag - /hipoteca toggles by checking for one
    uniqueIndex("hipoteca_sessions_user_idx").on(table.userId),
  ],
);

export const hipotecaHoldings = pgTable(
  "hipoteca_holdings",
  {
    sessionId: integer()
      .notNull()
      .references(() => hipotecaSessions.id, { onDelete: "cascade" }),
    cardId: integer().notNull().references(() => cards.id),
    count: integer().notNull(),
    tradable: boolean().notNull(),
    customEmoji: text(),
    customMediaUrl: text(),
    customMediaType: cativeiroMediaType(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.cardId] }),
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

// one-time claim per (user, subcategory) - the composite PK is the TOCTOU guard against double-claiming.
export const subcategoryCompletionRewards = pgTable(
  "subcategory_completion_rewards",
  {
    userId: integer()
      .notNull()
      .references(() => users.id),
    subcategoryId: integer()
      .notNull()
      .references(() => subcategories.id, { onDelete: "cascade" }),
    coinsAwarded: integer().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.subcategoryId] }),
    index("subcategory_completion_rewards_sub_idx").on(table.subcategoryId),
  ],
);

export const cardDrawHistory = pgTable(
  "card_draw_history",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer().notNull().references(() => users.id),
    cardId: integer().notNull().references(() => cards.id),
    categoryId: integer().notNull().references(() => categories.id),
    subcategoryId: integer().notNull().references(() => subcategories.id, { onDelete: "cascade" }),
    drawnAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    // append-only, ever-growing, had zero indexes beyond the PK - was seq-scanned constantly
    index("card_draw_history_card_idx").on(table.cardId),
    index("card_draw_history_drawn_at_idx").on(table.drawnAt),
  ],
);

export const chocolateFactoryCorrections = pgTable("chocolate_factory_corrections", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  targetName: text().notNull().unique(),
  subcategoryId: integer().notNull().references(() => subcategories.id, { onDelete: "cascade" }),
});

export const auctionStatus = pgEnum("auction_status", ["active", "sold", "expired", "cancelled"])

export const auctions = pgTable(
  "auctions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    sellerId: integer().notNull().references(() => users.id),
    cardId: integer().notNull().references(() => cards.id),

    // snapshot of the listed unit's customization, taken out of userCards at creation time -
    // same shape as hipotecaHoldings, restored (to the seller) or dropped (to the winner) at settlement.
    tradable: boolean().notNull(),
    customEmoji: text(),
    customMediaUrl: text(),
    customMediaType: cativeiroMediaType(),

    status: auctionStatus().notNull().default("active"),

    // all fixed at creation time from rarities.auctionBaseValue x economy.inflationRate (then
    // rounded to the nearest 500) - never recomputed live, so a later inflation change doesn't
    // retroactively affect an auction already in progress.
    startingBid: integer().notNull(),
    capPrice: integer().notNull(),
    bidIncrement: integer().notNull(),
    overtimeIncrement: integer().notNull(),

    currentBid: integer(),
    currentBidderId: integer().references(() => users.id),

    // set only once settled 'sold' - the commission taken out of currentBid at payout time
    saleFeePaid: integer(),

    createdAt: timestamp().notNull().defaultNow(),
    expiresAt: timestamp().notNull(),
    resolvedAt: timestamp(),

    // notification outbox for sold/expired/cancelled - see AuctionsDB/CronJobs.runAuctionSweep
    resolutionNotifiedAt: timestamp(),
  },
  (table) => [
    // the real "one active auction per (seller, card)" guard - not an app-level pre-check
    uniqueIndex("auctions_active_seller_card_idx").on(table.sellerId, table.cardId).where(sql`${table.status} = 'active'`),
    index("auctions_status_expires_idx").on(table.status, table.expiresAt),
    // /leilao's 3-per-day limit and the 6h re-list cooldown both scan by (sellerId, createdAt)/(sellerId, cardId, resolvedAt)
    index("auctions_seller_created_idx").on(table.sellerId, table.createdAt),
  ],
);

export const auctionBids = pgTable(
  "auction_bids",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    auctionId: integer().notNull().references(() => auctions.id),
    bidderId: integer().notNull().references(() => users.id),
    amount: integer().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    // outbid-notification outbox - see AuctionsDB/CronJobs.runAuctionSweep
    notifiedAt: timestamp(),
  },
  (table) => [
    index("auction_bids_auction_idx").on(table.auctionId),
    // used by the site's "a licitar" (bids by this user) listing.
    index("auction_bids_bidder_idx").on(table.bidderId),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    user1Id: integer().notNull().references(() => users.id),
    user2Id: integer().notNull().references(() => users.id),
    cardsUser1: integer().array().notNull(),
    cardsUser2: integer().array().notNull(),
    // Discoteca entry ids offered by each side, same flatten-by-count shape as cardsUser1/2 -
    // see CardsDB.executeMixedTrade.
    discotecaUser1: integer().array().notNull().default([]),
    discotecaUser2: integer().array().notNull().default([]),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    // getTradeStats scans by each side separately - table grows monotonically, was seq-scanning
    index("trades_user1_idx").on(table.user1Id),
    index("trades_user2_idx").on(table.user2Id),
  ],
);
