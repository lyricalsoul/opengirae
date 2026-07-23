import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { CardsDB } from "../../cards";

describe("CardsDB.getCardByName", () => {
  const fx = new TestFixtures();
  let firstCardId: number;
  const name = `Test GetCardByName ${Date.now()}`;

  beforeAll(async () => {
    firstCardId = (await fx.card({ name })).id;
    await fx.card({ name });
  });

  afterAll(() => fx.cleanup());

  test("returns the first card (by id) when multiple cards share a name", async () => {
    const result = await CardsDB.getCardByName(name);
    expect(result?.id).toBe(firstCardId);
  });

  test("matches case-insensitively", async () => {
    const result = await CardsDB.getCardByName(name.toUpperCase());
    expect(result?.id).toBe(firstCardId);
  });

  test("returns undefined for a name nobody has", async () => {
    const result = await CardsDB.getCardByName("zzzznonexistentcardnamezzzz");
    expect(result).toBeUndefined();
  });
});
