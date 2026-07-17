import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { cards, rarities } from "../../schemas/cards";
import { eq, inArray } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.getCardByName", () => {
  let rarityId: number;
  let firstCardId: number, secondCardId: number;
  const name = `Test GetCardByName ${Date.now()}`;

  beforeAll(async () => {
    rarityId = await db.select().from(rarities).limit(1).then(r => r[0]!.id);

    const [first] = await db.insert(cards).values({ name, rarityId }).returning();
    firstCardId = first!.id;
    const [second] = await db.insert(cards).values({ name, rarityId }).returning();
    secondCardId = second!.id;
  });

  afterAll(async () => {
    await db.delete(cards).where(inArray(cards.id, [firstCardId, secondCardId]));
  });

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
