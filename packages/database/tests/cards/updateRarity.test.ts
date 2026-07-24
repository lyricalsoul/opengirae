import { test, expect, describe, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { CardsDB } from "../../cards";

describe("CardsDB.updateRarity", () => {
  const fx = new TestFixtures();

  afterAll(() => fx.cleanup());

  test("partially updates only the given fields", async () => {
    const rarity = await fx.rarity({ name: "Test Update Rarity", weight: 100, cativeiroThreshold: 15 });

    const updated = await CardsDB.updateRarity(rarity.id, { cativeiroThreshold: 42 });
    expect(updated?.cativeiroThreshold).toBe(42);
    expect(updated?.weight).toBe(100); // untouched
  });
});
