import {
  jsonb,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export enum PromoRewardType {
  LUCK_MODIFIER = 'luckModifier',
  COINS = 'coins',
  USED_DRAWS = 'usedDraws'
}

export const promoCodes = pgTable("promo_codes", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  code: text().notNull().unique(),
  rewards: jsonb().notNull().$type<Partial<Record<PromoRewardType, number>>>(),
  maxUses: integer(),
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});

export const promoCodeRedemptions = pgTable("promo_code_redemptions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id),
  promoCodeId: integer().notNull().references(() => promoCodes.id),
  redeemedAt: timestamp().notNull().defaultNow(),
}, (table) => [
  unique().on(table.userId, table.promoCodeId),
]);
