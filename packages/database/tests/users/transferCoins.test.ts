import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, caught } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";
import { EconomyDB } from "../../economy";

describe("UsersDB.transferCoins moves coins between users without touching the treasury", () => {
  const fx = new TestFixtures();
  let senderId: number, recipientId: number;

  beforeAll(async () => {
    senderId = (await fx.user({ displayName: "Test Transfer Sender" })).id;
    recipientId = (await fx.user({ displayName: "Test Transfer Recipient" })).id;
  });

  afterAll(() => fx.cleanup());

  test("a successful transfer moves coins from sender to recipient and doesn't touch the treasury", async () => {
    await db.update(users).set({ coins: 5000, treasuryContributed: 0 }).where(eq(users.id, senderId));
    await db.update(users).set({ coins: 1000 }).where(eq(users.id, recipientId));
    const before = await EconomyDB.getState();

    const ok = await UsersDB.transferCoins(senderId, recipientId, 2000);
    expect(ok).toBe(true);

    const [sender] = await db.select().from(users).where(eq(users.id, senderId));
    expect(sender!.coins).toBe(3000);
    expect(sender!.treasuryContributed).toBe(0);

    const [recipient] = await db.select().from(users).where(eq(users.id, recipientId));
    expect(recipient!.coins).toBe(3000);

    const after = await EconomyDB.getState();
    expect(after.treasuryBalance).toBe(before.treasuryBalance);
  });

  test("insufficient funds returns false and touches neither user", async () => {
    await db.update(users).set({ coins: 100 }).where(eq(users.id, senderId));
    await db.update(users).set({ coins: 1000 }).where(eq(users.id, recipientId));

    const ok = await UsersDB.transferCoins(senderId, recipientId, 999999);
    expect(ok).toBe(false);

    const [sender] = await db.select().from(users).where(eq(users.id, senderId));
    expect(sender!.coins).toBe(100);

    const [recipient] = await db.select().from(users).where(eq(users.id, recipientId));
    expect(recipient!.coins).toBe(1000);
  });

  test("a non-positive amount is refused instead of reversing the transfer", async () => {
    await db.update(users).set({ coins: 500 }).where(eq(users.id, senderId));
    await db.update(users).set({ coins: 500 }).where(eq(users.id, recipientId));

    expect(await UsersDB.transferCoins(senderId, recipientId, -300)).toBe(false);
    expect(await UsersDB.transferCoins(senderId, recipientId, 0)).toBe(false);

    const [sender] = await db.select().from(users).where(eq(users.id, senderId));
    const [recipient] = await db.select().from(users).where(eq(users.id, recipientId));
    expect([sender!.coins, recipient!.coins]).toEqual([500, 500]);
  });

  test("a recipient that doesn't exist rolls the debit back instead of burning the coins", async () => {
    await db.update(users).set({ coins: 500 }).where(eq(users.id, senderId));

    const err = await caught(UsersDB.transferCoins(senderId, 2_000_000_000, 100));
    expect(String(err)).toContain('does not exist');

    const [sender] = await db.select().from(users).where(eq(users.id, senderId));
    expect(sender!.coins).toBe(500);
  });
});
