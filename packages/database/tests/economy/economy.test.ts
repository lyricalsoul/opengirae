import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { EconomyDB } from "../../economy";

describe("EconomyDB", () => {
  const fx = new TestFixtures();
  let userId: number;
  let originalInflationRate: number;
  let originalIncomeInflationRate: number;
  let originalTreasuryBalance: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Economy" })).id;
    const state = await EconomyDB.getState();
    originalInflationRate = state.inflationRate;
    originalIncomeInflationRate = state.incomeInflationRate;
    originalTreasuryBalance = state.treasuryBalance;
  });

  afterAll(async () => {
    await EconomyDB.setInflationRate(originalInflationRate);
    await EconomyDB.setIncomeInflationRate(originalIncomeInflationRate);
    await EconomyDB.setTreasuryBalance(originalTreasuryBalance);
    await fx.cleanup();
  });

  test("getState returns the singleton row", async () => {
    const state = await EconomyDB.getState();
    expect(state.id).toBeGreaterThan(0);
    expect(typeof state.treasuryBalance).toBe('number');
  });

  test("applyInflation rounds basePrice * inflationRate, independent of incomeInflationRate", async () => {
    await EconomyDB.setInflationRate(1.1);
    await EconomyDB.setIncomeInflationRate(5); // deliberately different, to prove independence

    expect(await EconomyDB.applyInflation(100)).toBe(110);
    expect(await EconomyDB.applyInflation(99)).toBe(109); // 108.9 rounds to 109
  });

  test("applyIncomeInflation rounds baseAmount * incomeInflationRate, independent of inflationRate", async () => {
    await EconomyDB.setInflationRate(5); // deliberately different, to prove independence
    await EconomyDB.setIncomeInflationRate(1.5);

    expect(await EconomyDB.applyIncomeInflation(100)).toBe(150);
  });

  test("deductCoinsToTreasury moves coins from the user into the treasury and the user's contribution counter, atomically", async () => {
    await db.update(users).set({ coins: 500, treasuryContributed: 0 }).where(eq(users.id, userId));
    const before = await EconomyDB.getState();

    const ok = await db.transaction(client => EconomyDB.deductCoinsToTreasury(client, userId, 200));
    expect(ok).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(300);
    expect(user!.treasuryContributed).toBe(200);

    const after = await EconomyDB.getState();
    expect(after.treasuryBalance - before.treasuryBalance).toBe(200);
  });

  test("deductCoinsToTreasury returns false and touches nothing on insufficient funds", async () => {
    await db.update(users).set({ coins: 10, treasuryContributed: 0 }).where(eq(users.id, userId));
    const before = await EconomyDB.getState();

    const ok = await db.transaction(client => EconomyDB.deductCoinsToTreasury(client, userId, 500));
    expect(ok).toBe(false);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(10);
    expect(user!.treasuryContributed).toBe(0);

    const after = await EconomyDB.getState();
    expect(after.treasuryBalance).toBe(before.treasuryBalance);
  });

  test("setTreasuryBalance overrides the balance directly, not as a delta", async () => {
    await EconomyDB.setTreasuryBalance(12345);
    expect((await EconomyDB.getState()).treasuryBalance).toBe(12345);

    await EconomyDB.setTreasuryBalance(0);
    expect((await EconomyDB.getState()).treasuryBalance).toBe(0);
  });
});
