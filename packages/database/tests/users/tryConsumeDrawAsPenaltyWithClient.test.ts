import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";

describe("UsersDB.tryConsumeDrawAsPenaltyWithClient", () => {
  const fx = new TestFixtures();
  let userId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Draw Penalty" })).id;
  });

  afterAll(() => fx.cleanup());

  beforeEach(async () => {
    await db.update(users).set({ usedDraws: 0, maxDraws: 24 }).where(eq(users.id, userId));
  });

  test("takes a draw when one is available", async () => {
    const ok = await db.transaction(client => UsersDB.tryConsumeDrawAsPenaltyWithClient(client, userId));
    expect(ok).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.usedDraws).toBe(1);
  });

  test("returns false and touches nothing once every draw is already used", async () => {
    await db.update(users).set({ usedDraws: 24 }).where(eq(users.id, userId));

    const ok = await db.transaction(client => UsersDB.tryConsumeDrawAsPenaltyWithClient(client, userId));
    expect(ok).toBe(false);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.usedDraws).toBe(24);
  });
});
