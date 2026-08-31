import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { CardsDB } from "../../cards";

describe("CardsDB.getCategories", () => {
  const fx = new TestFixtures();
  let firstId: number, secondId: number, thirdId: number;

  beforeAll(async () => {
    firstId = (await fx.category({ name: "Test GetCategories A" })).id;
    secondId = (await fx.category({ name: "Test GetCategories B" })).id;
    thirdId = (await fx.category({ name: "Test GetCategories C" })).id;

    // editing the oldest row moves its physical storage tuple last, reproducing the "categorias fora de ordem" bug without an explicit ORDER BY.
    await CardsDB.updateCategory(firstId, { name: "Test GetCategories A (edited)" });
  });

  afterAll(() => fx.cleanup());

  test("returns categories ordered by id, regardless of physical row order", async () => {
    const all = await CardsDB.getCategories();
    const ids = all.map(c => c.id).filter(id => [firstId, secondId, thirdId].includes(id));
    expect(ids).toEqual([firstId, secondId, thirdId]);
  });
});
