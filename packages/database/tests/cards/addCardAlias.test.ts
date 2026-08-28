import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { CardsDB } from "../../cards";

describe("CardsDB.addCardAlias / getCardByAlias", () => {
  const fx = new TestFixtures();
  let cardId: number;
  let otherCardId: number;

  beforeAll(async () => {
    cardId = (await fx.card({ name: `Test CardAlias ${Date.now()}` })).id;
    otherCardId = (await fx.card({ name: `Test CardAlias Other ${Date.now()}` })).id;
  });

  afterAll(() => fx.cleanup());

  test("resolves the aliased card, case-insensitively and trimmed", async () => {
    await CardsDB.addCardAlias(cardId, "TCAlias");

    const byExact = await CardsDB.getCardByAlias("tcalias");
    expect(byExact?.id).toBe(cardId);

    const byMixedCaseWithSpaces = await CardsDB.getCardByAlias("  TcAlias  ");
    expect(byMixedCaseWithSpaces?.id).toBe(cardId);
  });

  test("adding the same alias twice doesn't duplicate it in the array", async () => {
    await CardsDB.addCardAlias(cardId, "tcdupe");
    const updated = await CardsDB.addCardAlias(cardId, "tcdupe");
    expect(updated!.aliases!.filter(a => a === "tcdupe")).toHaveLength(1);
  });

  test("an alias on one card never resolves another card", async () => {
    await CardsDB.addCardAlias(cardId, "tcnotother");
    const result = await CardsDB.getCardByAlias("tcnotother");
    expect(result?.id).not.toBe(otherCardId);
  });

  test("an alias nobody set resolves to nothing", async () => {
    const result = await CardsDB.getCardByAlias("zzzznonexistentcardaliaszzzz");
    expect(result).toBeUndefined();
  });
});
