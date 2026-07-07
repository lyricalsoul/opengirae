import { relations } from "drizzle-orm";
import { userCards, cards, categories, subcategories, rarities, cardSubcategories } from "./cards";
import { users, userProfiles } from "./users";

export const userRelations = relations(users, ({ many, one }) => ({
  cards: many(userCards),
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  partner: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.partnerId],
  }),
}));

export const cardRelations = relations(cards, ({ many, one }) => ({
  subcategories: many(cardSubcategories),
  rarity: one(rarities, {
    fields: [cards.rarityId],
    references: [rarities.id],
  }),
}));
