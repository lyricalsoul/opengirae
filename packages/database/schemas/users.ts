import {
  integer,
  pgTable,
  text,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { cards } from "./cards";
import { storeItems } from "./vanities";

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  username: text(),
  isBanned: boolean().notNull().default(false),
  banMessage: text(),
  isAdmin: boolean().notNull().default(false),

  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),

  luckModifier: integer().notNull().default(100),
  coins: integer().notNull().default(0),
  privacyMode: boolean().notNull().default(false),
  makeCardsTradeableByDefault: boolean().notNull().default(false),

  displayName: text().notNull(),
  avatarUrl: text().notNull(),
  avatarUpdatedAt: timestamp(),

  maxDraws: integer().notNull().default(24),
  usedDraws: integer().notNull().default(0),
  hasGottenDaily: boolean().notNull().default(false),
  dailyStreak: integer().notNull().default(0),
  hasJoinedSupportChannel: boolean().notNull().default(false),
  supportChannelCheckedAt: timestamp(),
  hasGivenRepToday: boolean().notNull().default(false),
  // TODO: if user loses card, this should be set to NULL. they need the card to make them their favorite.
  favoriteCardId: integer()
    .references(() => cards.id)
});

export const userProfiles = pgTable("user_profiles", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer()
    .notNull()
    .unique()
    .references(() => users.id),

  bio: text().notNull().default("Eu ainda não defini minha bio usando /bio!"),
  reputation: integer().notNull().default(0),
  favoriteColor: text().notNull().default("#FF94DB"),
  favoriteCardColor: text(),

  isMarried: boolean().notNull().default(false),
  partnerId: integer().references(() => users.id),

  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),

  hideProfileEmojis: boolean().notNull().default(false),

  equipedBackgroundId: integer().references(() => storeItems.id, { onDelete: "set null" }),
  equipedStickerId: integer().references(() => storeItems.id, { onDelete: "set null" }),
  equipedProfileId: integer().references(() => storeItems.id, { onDelete: "set null" })
});

export const linkedAccounts = pgTable("linked_accounts", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id),
  platform: text().notNull(), // 'telegram' | 'discord'
  platformId: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
}, (t) => [unique().on(t.platform, t.platformId)]);
