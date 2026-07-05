import {
  integer,
  pgTable,
  text,
  boolean,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  telegramId: text().notNull().unique(),
  isBanned: boolean().notNull().default(false),
  banMessage: text(),

  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),

  displayName: text().notNull(),
  avatarUrl: text().notNull(),
});

export const userProfiles = pgTable("user_profiles", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer()
    .notNull()
    .references(() => users.id),

  bio: text(),
  coins: integer().notNull().default(0),
  reputation: integer().notNull().default(0),
  favoriteColor: text().notNull().default("#FF94DB"),
  privacyMode: boolean().notNull().default(false),
  luckModifier: doublePrecision().notNull().default(1),

  isMarried: boolean().notNull().default(false),
  partnerId: integer().references(() => users.id),

  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});
