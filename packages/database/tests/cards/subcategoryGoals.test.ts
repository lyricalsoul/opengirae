import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { subcategoryGoals } from "../../schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB goal (favorite collection) methods", () => {
  const fx = new TestFixtures();
  let userId: number;
  let categoryId: number;
  let subA: number, subB: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Goals" })).id;
    categoryId = (await fx.category({ name: "Test Goals Category" })).id;
    subA = (await fx.subcategory({ categoryId, name: "Test Goals Sub A" })).id;
    subB = (await fx.subcategory({ categoryId, name: "Test Goals Sub B" })).id;

    fx.onCleanup(async () => { await db.delete(subcategoryGoals).where(eq(subcategoryGoals.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("isOnGoals is false before anything is added", async () => {
    expect(await CardsDB.isOnGoals(userId, subA)).toBe(false);
  });

  test("addToGoals adds a subcategory, isOnGoals reflects it, adding twice is idempotent", async () => {
    await CardsDB.addToGoals(userId, subA);
    expect(await CardsDB.isOnGoals(userId, subA)).toBe(true);

    await CardsDB.addToGoals(userId, subA);
    const rows = await db.select().from(subcategoryGoals).where(eq(subcategoryGoals.userId, userId));
    expect(rows.filter(r => r.subcategoryId === subA)).toHaveLength(1);
  });

  test("removeFromGoals removes it", async () => {
    await CardsDB.removeFromGoals(userId, subA);
    expect(await CardsDB.isOnGoals(userId, subA)).toBe(false);
  });

  test("getGoalSubcategoryIdsForUser returns subcategoryId+categoryId pairs", async () => {
    await CardsDB.addToGoals(userId, subA);
    await CardsDB.addToGoals(userId, subB);

    const goals = await CardsDB.getGoalSubcategoryIdsForUser(userId);
    expect(goals.map(g => g.subcategoryId).sort()).toEqual([subA, subB].sort());
    expect(goals.every(g => g.categoryId === categoryId)).toBe(true);

    await CardsDB.removeFromGoals(userId, subA);
    await CardsDB.removeFromGoals(userId, subB);
  });

  test("getGoals returns paginated rows with names", async () => {
    await CardsDB.addToGoals(userId, subA);
    await CardsDB.addToGoals(userId, subB);

    const { rows, total } = await CardsDB.getGoals(userId, {});
    expect(total).toBe(2);
    expect(rows.map(r => r.subcategoryName).sort()).toEqual(["Test Goals Sub A", "Test Goals Sub B"]);

    await CardsDB.removeFromGoals(userId, subA);
    await CardsDB.removeFromGoals(userId, subB);
  });

  test("getSubcategoriesByIds resolves multiple ids and ignores unknown ones", async () => {
    const found = await CardsDB.getSubcategoriesByIds([subA, subB, -1]);
    expect(found.map(s => s.id).sort()).toEqual([subA, subB].sort());
  });

  test("getSubcategoriesByIds returns [] for an empty id list", async () => {
    expect(await CardsDB.getSubcategoriesByIds([])).toEqual([]);
  });
});
