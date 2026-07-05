import { load } from "js-yaml";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  createCategory,
  createRarity,
  createSubcategory,
  createCard,
} from "./cards";

const doc = load(
  readFileSync(resolve(__dirname + "/../../", "seed.yaml"), "utf8"),
);

const { rarities, subcategories, cards, categories } = doc as {
  categories: { name: string }[];
  rarities: { name: string; emoji: string }[];
  subcategories: { name: string; categoryId: string }[];
  cards: { texts: string; subcategoryId: string }[];
};

for (const rarity of rarities) {
  await createRarity(rarity.name, rarity.emoji, 0.5);
}

for (const category of categories) {
  await createCategory(category.name);
}

for (const subcategory of subcategories) {
  await createSubcategory(subcategory.name, parseInt(subcategory.categoryId));
}

let i = 0;
for (const cardList of cards) {
  const allCards = cardList.texts.split(",").map((text: string) => text.trim());
  for (const cardName of allCards) {
    await createCard(cardName, 1, parseInt(cardList.subcategoryId));
    i++;
  }
}

console.log(
  `${i} cards created, ${rarities.length} rarities, ${categories.length} categories, ${subcategories.length} subcategories`,
);
