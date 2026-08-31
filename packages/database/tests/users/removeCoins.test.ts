import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";

describe("UsersDB.removeCoins", () => {
  const fx = new TestFixtures();
  let userId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Remove Coins" })).id;
  });

  afterAll(() => fx.cleanup());

  test("removes coins when the user has enough", async () => {
    await db.update(users).set({ coins: 1000, treasuryContributed: 0 }).where(eq(users.id, userId));

    const ok = await UsersDB.removeCoins(userId, 400);
    expect(ok).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(600);
    // confiscation isn't a purchase - shouldn't be tracked as a contribution.
    expect(user!.treasuryContributed).toBe(0);
  });

  test("fails atomically when the user doesn't have enough", async () => {
    await db.update(users).set({ coins: 100 }).where(eq(users.id, userId));

    const ok = await UsersDB.removeCoins(userId, 500);
    expect(ok).toBe(false);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(100);
  });

  test("concurrent removals against a tight balance: only what's available gets taken", async () => {
    await db.update(users).set({ coins: 100 }).where(eq(users.id, userId));

    const [a, b] = await Promise.all([
      UsersDB.removeCoins(userId, 100),
      UsersDB.removeCoins(userId, 100),
    ]);

    const wins = [a, b].filter(Boolean).length;
    expect(wins).toBe(1);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(0);
  });
});
