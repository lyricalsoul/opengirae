import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { promoCodes, promoCodeRedemptions, PromoRewardType } from "../../schemas/promo";
import { PromoDB } from "../../promo";
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

    const code = await PromoDB.consumeCode("TESTCODE123", userId1);
    expect(code).toBeDefined();

    // Verify rewards applied
    const [updatedUser] = await db.select().from(users).where(eq(users.id, userId1));
    expect(updatedUser!.coins).toBe(100); // 0 + 100
    expect(updatedUser!.luckModifier).toBe(105); // default 100 + 5
    expect(updatedUser!.usedDraws).toBe(-3); // default 0 - 3
  });

  test("should throw if user already redeemed", async () => {
    await expect(PromoDB.consumeCode("TESTCODE123", userId1)).rejects.toThrow("Você já resgatou este código.");
  });

  test("should throw if maxUses reached", async () => {
    await expect(PromoDB.consumeCode("TESTCODE123", userId2)).rejects.toThrow("O limite de resgates para este código foi atingido.");
  });
});
