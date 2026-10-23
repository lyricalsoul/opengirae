import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, caught, seedStorefront } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { userCards } from "../../schemas/cards";
import { storefrontPurchases } from "../../schemas/storefront";
import { eq, and } from "drizzle-orm";
import { StorefrontDB, StorefrontCardUnavailableError } from "../../storefront";
import { EconomyDB } from "../../economy";

describe("StorefrontDB.buyCard", () => {
  const fx = new TestFixtures();
  let userId: number;
  let cardId: number;
  let storefrontId: number;
  const PRICE = 50000;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Buy Storefront Card" })).id;
    await db.update(users).set({ coins: 200000 }).where(eq(users.id, userId));

    const state = await seedStorefront(fx);
    storefrontId = state.id;
    cardId = state.cardIds[0]!;

    fx.onCleanup(async () => {
      await db.delete(storefrontPurchases).where(and(eq(storefrontPurchases.storefrontId, storefrontId), eq(storefrontPurchases.userId, userId)));
      await db.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    });
  });

  afterAll(() => fx.cleanup());

  test("a successful purchase spends coins, grants the card, and credits the treasury", async () => {
    const incomeRate = await EconomyDB.getIncomeInflationRate();
    const beforeUser = await db.select().from(users).where(eq(users.id, userId)).then(r => r[0]!);
    const beforeEconomy = await EconomyDB.getState();

    const result = await StorefrontDB.buyCard(userId, cardId, storefrontId, PRICE, incomeRate);
    expect(result.ok).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(beforeUser.coins - user!.coins).toBeGreaterThanOrEqual(PRICE);

    const [owned] = await db.select().from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
    expect(owned!.count).toBe(1);

    const after = await EconomyDB.getState();
    expect(after.treasuryBalance - beforeEconomy.treasuryBalance).toBe(PRICE);
  });

  test("buying the same card again in the same rotation throws (already bought)", async () => {
    const incomeRate = await EconomyDB.getIncomeInflationRate();
    const before = await db.select().from(users).where(eq(users.id, userId)).then(r => r[0]!);

    expect(await caught(StorefrontDB.buyCard(userId, cardId, storefrontId, PRICE, incomeRate))).toBeInstanceOf(StorefrontCardUnavailableError);

    const after = await db.select().from(users).where(eq(users.id, userId)).then(r => r[0]!);
    expect(after.coins).toBe(before.coins);
  });

  test("insufficient funds returns a clean false, no throw", async () => {
    await db.update(users).set({ coins: 100 }).where(eq(users.id, userId));
    const incomeRate = await EconomyDB.getIncomeInflationRate();

    const result = await StorefrontDB.buyCard(userId, cardId, storefrontId, PRICE, incomeRate);
    expect(result).toEqual({ ok: false, reason: 'insufficient_funds' });
  });

  test("a stale storefrontId (rotation moved on) is rejected", async () => {
    await db.update(users).set({ coins: 200000 }).where(eq(users.id, userId));
    const incomeRate = await EconomyDB.getIncomeInflationRate();

    expect(await caught(StorefrontDB.buyCard(userId, cardId, storefrontId + 999999, PRICE, incomeRate))).toBeInstanceOf(StorefrontCardUnavailableError);
  });
});
