import { load } from "js-yaml";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "./index";
import {
  rarities,
  categories,
  subcategories,
  cards,
  cardSubcategories,
} from "./schemas/cards";

const __dirname = dirname(fileURLToPath(import.meta.url));

const doc = load(
  readFileSync(resolve(__dirname, "../../seed.yaml"), "utf8"),
) as {
  categories: { id: number; name: string; emoji?: string }[];
  subcategories: { id: number; categoryId: number; name: string }[];
  cards: { subcategoryId: number; texts: string }[];
  rarities: { id: number; name: string; emoji: string }[];
};

console.log("Seeding database...");

// Rarities
for (const rarity of doc.rarities) {
  await db
    .insert(rarities)
    .values({ name: rarity.name, emoji: rarity.emoji, weight: 100 })
    .onConflictDoNothing();
}
console.log(`${doc.rarities.length} rarities`);

// Categories
for (const category of doc.categories) {
  await db
    .insert(categories)
    .values({ name: category.name, emoji: category.emoji ?? "🏷️" })
    .onConflictDoNothing();
}
console.log(`${doc.categories.length} categories`);

const insertedCategories = await db.select().from(categories);
const categoryByName = Object.fromEntries(insertedCategories.map((c) => [c.name, c.id]));

for (const sub of doc.subcategories) {
  const seedCategory = doc.categories.find((c) => c.id === sub.categoryId);
  if (!seedCategory) {
    console.warn(`subcategory "${sub.name}": categoryId ${sub.categoryId} not found in seed`);
    continue;
  }
  const realCategoryId = categoryByName[seedCategory.name];
  await db
    .insert(subcategories)
    .values({ name: sub.name, categoryId: realCategoryId! })
    .onConflictDoNothing();
}
console.log(`${doc.subcategories.length} subcategories`);

const insertedSubcategories = await db.select().from(subcategories);

const subNameById = Object.fromEntries(doc.subcategories.map((s) => [s.id, s.name]));
const realSubIdByName = Object.fromEntries(insertedSubcategories.map((s) => [s.name, s.id]));

const insertedRarities = await db.select().from(rarities);
const defaultRarityId = insertedRarities[0]?.id ?? 1;

let cardCount = 0;
for (const cardGroup of doc.cards) {
  const subName = subNameById[cardGroup.subcategoryId];
  if (!subName) {
    console.warn(`card group: subcategoryId ${cardGroup.subcategoryId} not found in seed`);
    continue;
  }
  const realSubId = realSubIdByName[subName];
  const cardNames = cardGroup.texts.split(",").map((t: string) => t.trim());

  for (const name of cardNames) {
    const [card] = await db
      .insert(cards)
      .values({ name, rarityId: defaultRarityId })
      .onConflictDoNothing()
      .returning();

    if (card) {
      await db
        .insert(cardSubcategories)
        .values({ cardId: card.id, subcategoryId: realSubId!, isMain: true })
        .onConflictDoNothing();
      cardCount++;
    }
  }
}
console.log(`${cardCount} cards`);

console.log("Seeded");
