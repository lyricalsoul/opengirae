import {
  integer,
  pgTable,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { cards } from "./cards";

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  telegramId: text().notNull().unique(),
  isBanned: boolean().notNull().default(false),
  banMessage: text(),

  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),

  luckModifier: integer().notNull().default(100),
  coins: integer().notNull().default(0),
  privacyMode: boolean().notNull().default(false),

  displayName: text().notNull(),
  avatarUrl: text().notNull(),

  maxDraws: integer().notNull().default(12),
  usedDraws: integer().notNull().default(0),
  hasGottenDaily: boolean().notNull().default(false),
  dailyStreak: integer().notNull().default(0),
  // TODO: if user loses card, this should be set to NULL. they need the card to make them their favorite.
  favoriteCardId: integer()
    .references(() => cards.id)
});

export const userProfiles = pgTable("user_profiles", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer()
    .notNull()
    .references(() => users.id),

  bio: text(),
  reputation: integer().notNull().default(0),
  favoriteColor: text().notNull().default("#FF94DB"),

  isMarried: boolean().notNull().default(false),
  partnerId: integer().references(() => users.id),

  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});
