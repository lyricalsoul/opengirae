import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";
import { EconomyDB } from "../../economy";

describe("UsersDB.spendCoins credits the treasury", () => {
  const fx = new TestFixtures();
  let userId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Spend Coins" })).id;
    await db.update(users).set({ coins: 300 }).where(eq(users.id, userId));
  });

  afterAll(() => fx.cleanup());

  test("a successful spend credits the treasury and the user's contribution counter", async () => {
    const before = await EconomyDB.getState();

    const ok = await UsersDB.spendCoins(userId, 100);
    expect(ok).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(200);
    expect(user!.treasuryContributed).toBe(100);

    const after = await EconomyDB.getState();
    expect(after.treasuryBalance - before.treasuryBalance).toBe(100);
  });

  test("insufficient funds returns false and touches neither counter", async () => {
    const before = await EconomyDB.getState();

    const ok = await UsersDB.spendCoins(userId, 999999);
    expect(ok).toBe(false);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(200); // unchanged from previous test
    expect(user!.treasuryContributed).toBe(100); // unchanged

    const after = await EconomyDB.getState();
    expect(after.treasuryBalance).toBe(before.treasuryBalance);
  });
});
