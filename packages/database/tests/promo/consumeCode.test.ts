import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { promoCodes, promoCodeRedemptions, PromoRewardType } from "../../schemas/promo";
import { PromoDB } from "../../promo";
import { EconomyDB } from "../../economy";
import { eq } from "drizzle-orm";

describe("PromoDB.consumeCode", () => {
  const fx = new TestFixtures();
  let userId1: number;
  let userId2: number;

  beforeAll(async () => {
    userId1 = (await fx.user({ displayName: "Promo Test User 1" })).id;
    userId2 = (await fx.user({ displayName: "Promo Test User 2" })).id;

    fx.onCleanup(async () => {
      await db.delete(promoCodeRedemptions);
      await db.delete(promoCodes).where(eq(promoCodes.code, "TESTCODE123"));
    });
  });

  afterAll(() => fx.cleanup());

  test("should successfully redeem a code and apply rewards", async () => {
    // Create a code with maxUses = 1
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + 1); // expires tomorrow

    await db.insert(promoCodes).values({
      code: "TESTCODE123",
      rewards: {
        [PromoRewardType.COINS]: 100,
        [PromoRewardType.LUCK_MODIFIER]: 5,
        [PromoRewardType.USED_DRAWS]: 3 // translates to -3 usedDraws
      },
      maxUses: 1,
      expiresAt: expiration
    });

    const result = await PromoDB.consumeCode("TESTCODE123", userId1);
    expect(result.ok).toBe(true);

    // Verify rewards applied
    const [updatedUser] = await db.select().from(users).where(eq(users.id, userId1));
    expect(updatedUser!.coins).toBe(100); // 0 + 100
    expect(updatedUser!.luckModifier).toBe(105); // default 100 + 5
    expect(updatedUser!.usedDraws).toBe(-3); // default 0 - 3
  });

  test("returns already_redeemed instead of throwing when the user already redeemed", async () => {
    const result = await PromoDB.consumeCode("TESTCODE123", userId1);
    expect(result).toEqual({ ok: false, reason: 'already_redeemed' });
  });

  test("returns max_uses instead of throwing when maxUses is reached", async () => {
    const result = await PromoDB.consumeCode("TESTCODE123", userId2);
    expect(result).toEqual({ ok: false, reason: 'max_uses' });
  });

  test("returns expired instead of throwing for an expired code", async () => {
    await db.insert(promoCodes).values({
      code: "EXPIREDTEST",
      rewards: { [PromoRewardType.COINS]: 100 },
      maxUses: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    try {
      const result = await PromoDB.consumeCode("EXPIREDTEST", userId2);
      expect(result).toEqual({ ok: false, reason: 'expired' });
    } finally {
      await db.delete(promoCodes).where(eq(promoCodes.code, "EXPIREDTEST"));
    }
  });

  test("returns not_found instead of throwing for a nonexistent code", async () => {
    const result = await PromoDB.consumeCode("NOPE404", userId2);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test("the coins reward scales with incomeInflationRate, but luckModifier/usedDraws don't", async () => {
    const originalIncomeInflationRate = await EconomyDB.getIncomeInflationRate();
    await EconomyDB.setIncomeInflationRate(2);

    const expiration = new Date();
    expiration.setDate(expiration.getDate() + 1);
    await db.insert(promoCodes).values({
      code: "SCALETEST",
      rewards: { [PromoRewardType.COINS]: 100, [PromoRewardType.LUCK_MODIFIER]: 5, [PromoRewardType.USED_DRAWS]: 3 },
      maxUses: 1,
      expiresAt: expiration,
    });

    try {
      await PromoDB.consumeCode("SCALETEST", userId2);

      const [user] = await db.select().from(users).where(eq(users.id, userId2));
      expect(user!.coins).toBe(200); // 100 * incomeInflationRate(2), not 100
      expect(user!.luckModifier).toBe(105); // unscaled: default 100 + 5
      expect(user!.usedDraws).toBe(-3); // unscaled: default 0 - 3
    } finally {
      await EconomyDB.setIncomeInflationRate(originalIncomeInflationRate);
      await db.delete(promoCodeRedemptions).where(eq(promoCodeRedemptions.userId, userId2));
      await db.delete(promoCodes).where(eq(promoCodes.code, "SCALETEST"));
    }
  });
});
