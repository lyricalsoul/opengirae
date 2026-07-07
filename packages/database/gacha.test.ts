import { test, expect, describe } from "bun:test";
import { GachaLogic, type SubcategoryForDraw, type CardForDraw } from "./gacha";

describe("Gacha Logic - Subcategory Selection", () => {
  const mockSubcategories: SubcategoryForDraw[] = [
    { id: 1, name: "Common Sub", rarityModifier: 100 },
    { id: 2, name: "Rare Sub", rarityModifier: 10 },
    { id: 3, name: "Legendary Sub", rarityModifier: 1 },
  ];

  test("selectSubcategories returns exact count requested without duplicates", () => {
    const selected = GachaLogic.selectSubcategories(mockSubcategories, 2, 100);
    expect(selected.length).toBe(2);
    expect(selected[0]!.id).not.toBe(selected[1]!.id);
  });

  test("high luck boosts chance of rare subcategories", () => {
    const iterations = 10000;
    
    // Normal luck (100)
    let rareCountNormal = 0;
    for (let i = 0; i < iterations; i++) {
      const selected = GachaLogic.selectSubcategories(mockSubcategories, 1, 100);
      if (selected[0]!.id === 2 || selected[0]!.id === 3) rareCountNormal++;
    }

    // High luck (200) - doubles weight of <100 rarities
    let rareCountHighLuck = 0;
    for (let i = 0; i < iterations; i++) {
      const selected = GachaLogic.selectSubcategories(mockSubcategories, 1, 200);
      if (selected[0]!.id === 2 || selected[0]!.id === 3) rareCountHighLuck++;
    }

    // High luck should result in more rare draws
    expect(rareCountHighLuck).toBeGreaterThan(rareCountNormal);
  });
});

describe("Gacha Logic - Card Selection", () => {
  const mockCards: CardForDraw[] = [
    { id: 1, name: "Common Card", rarityModifier: 100, rarityWeight: 1000, rarityEmoji: '⚪', imageUrl: null },
    { id: 2, name: "Rare Card", rarityModifier: 100, rarityWeight: 100, rarityEmoji: '🔵', imageUrl: null },
    { id: 3, name: "Legendary Card", rarityModifier: 100, rarityWeight: 10, rarityEmoji: '🟡', imageUrl: null },
  ];

  test("selectCard returns a card based on weighted probability", () => {
    const iterations = 50000;
    let counts = { 1: 0, 2: 0, 3: 0 };

    for (let i = 0; i < iterations; i++) {
      const card = GachaLogic.selectCard(mockCards);
      counts[card!.id as keyof typeof counts]++;
    }

    // Common (1000) > Rare (100) > Legendary (10)
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[3]);

    // Theoretical probabilities:
    // Total weight = 1110
    // Common = 1000/1110 = 90.09%
    // Rare = 100/1110 = 9.01%
    // Legendary = 10/1110 = 0.90%
    
    const legendaryPercent = counts[3] / iterations;
    
    // Legendary should be extremely rare, but possible. Assert it's around ~1%
    expect(legendaryPercent).toBeGreaterThan(0.005);
    expect(legendaryPercent).toBeLessThan(0.015);
  });

  test("card.rarityModifier boosts specific card drop rate", () => {
    const cards: CardForDraw[] = [
      { id: 1, name: "Normal Rare", rarityModifier: 100, rarityWeight: 100, rarityEmoji: '🔵', imageUrl: null },
      { id: 2, name: "Boosted Rare", rarityModifier: 200, rarityWeight: 100, rarityEmoji: '🔵', imageUrl: null }, // 2x as likely as Normal Rare
    ];

    const iterations = 10000;
    let counts = { 1: 0, 2: 0 };

    for (let i = 0; i < iterations; i++) {
      const card = GachaLogic.selectCard(cards);
      counts[card!.id as keyof typeof counts]++;
    }

    // Boosted Rare should be roughly double Normal Rare
    expect(counts[2]).toBeGreaterThan(counts[1] * 1.5);
  });
});
