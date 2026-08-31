import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";

describe("UsersDB.giveTemporaryDraws / takeTemporaryDraws", () => {
  const fx = new TestFixtures();
  let userId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Temporary Draws" })).id;
  });

  afterAll(() => fx.cleanup());

  test("giveTemporaryDraws grants extra giros by lowering usedDraws below zero", async () => {
    await db.update(users).set({ maxDraws: 24, usedDraws: 20 }).where(eq(users.id, userId));

    await UsersDB.giveTemporaryDraws(userId, 10);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.usedDraws).toBe(10);
    expect(user!.maxDraws - user!.usedDraws).toBe(14); // 4 normal + 10 bonus
  });

  test("takeTemporaryDraws confiscates giros by raising usedDraws", async () => {
    await db.update(users).set({ maxDraws: 24, usedDraws: 5 }).where(eq(users.id, userId));

    await UsersDB.takeTemporaryDraws(userId, 10);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.usedDraws).toBe(15);
  });

  test("takeTemporaryDraws clamps at maxDraws - remaining giros never goes negative", async () => {
    await db.update(users).set({ maxDraws: 24, usedDraws: 20 }).where(eq(users.id, userId));

    await UsersDB.takeTemporaryDraws(userId, 100);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.usedDraws).toBe(24);
    expect(user!.maxDraws - user!.usedDraws).toBe(0);
  });
});
