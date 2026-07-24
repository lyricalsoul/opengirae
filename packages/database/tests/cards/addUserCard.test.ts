import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards } from "../../schemas/cards";
import { and, eq } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB.addUserCard", () => {
  const fx = new TestFixtures();
  let userId: number;
  let cardId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test AddUserCard" })).id;
    cardId = (await fx.card({ name: "Test AddUserCard Card" })).id;
    fx.onCleanup(async () => { await db.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId))); });
  });

  afterAll(() => fx.cleanup());

  test("a fresh insert reports previousCount 0 and count 1", async () => {
    const row = await CardsDB.addUserCard(userId, cardId);
    expect(row?.previousCount).toBe(0);
    expect(row?.count).toBe(1);
  });

  test("an existing row reports the pre-update count as previousCount", async () => {
    const row = await CardsDB.addUserCard(userId, cardId);
    expect(row?.previousCount).toBe(1);
    expect(row?.count).toBe(2);
  });
});
