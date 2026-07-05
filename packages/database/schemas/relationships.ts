import { relations } from "drizzle-orm";
import { userCards, cards, categories, subcategories, rarities } from "./cards";
import { users, userProfiles } from "./users";

const userRelations = relations(users, ({ many, one }) => ({
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

export const cardRelations = relations(cards, ({ one }) => ({
  category: one(subcategories, {
    fields: [cards.subcategoryId],
    references: [subcategories.id],
  }),
  rarity: one(rarities, {
    fields: [cards.rarityId],
    references: [rarities.id],
  }),
}));
