import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { boughtItems } from "../../schemas/vanities";
import { eq } from "drizzle-orm";
import { VanitiesDB } from "../../vanities";
import { EconomyDB } from "../../economy";

describe("VanitiesDB.buyItem", () => {
  const fx = new TestFixtures();
  let userId: number;
  let itemId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Buy" })).id;
    await db.update(users).set({ coins: 1000 }).where(eq(users.id, userId));
    itemId = (await fx.storeItem({ title: `Test Buy Item ${Date.now()}`, type: 'background', price: 100 })).id;
  });

  afterAll(() => fx.cleanup());

  beforeEach(async () => {
    await db.delete(boughtItems).where(eq(boughtItems.itemId, itemId));
    await db.update(users).set({ coins: 1000, treasuryContributed: 0 }).where(eq(users.id, userId));
  });

  test("buys the item, deducts coins, and records ownership", async () => {
    const result = await VanitiesDB.buyItem(userId, itemId);
    expect(result).toEqual({ ok: true, chargedPrice: 100 });

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(900);

    const owned = await db.select().from(boughtItems).where(eq(boughtItems.userId, userId));
    expect(owned).toHaveLength(1);
  });

  test("buying credits the treasury, the user's contribution counter, and returns chargedPrice", async () => {
    const before = await EconomyDB.getState();

    const result = await VanitiesDB.buyItem(userId, itemId);
    expect(result).toEqual({ ok: true, chargedPrice: 100 });

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.treasuryContributed).toBe(100);

    const after = await EconomyDB.getState();
    expect(after.treasuryBalance - before.treasuryBalance).toBe(100);
  });

  test("fails with insufficient_funds and takes no coins if the price exceeds balance", async () => {
    await db.update(users).set({ coins: 10 }).where(eq(users.id, userId));

    const result = await VanitiesDB.buyItem(userId, itemId);
    expect(result).toEqual({ ok: false, reason: 'insufficient_funds' });

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(10);
  });

  test("fails with already_owned on a second purchase attempt", async () => {
    await VanitiesDB.buyItem(userId, itemId);
    const second = await VanitiesDB.buyItem(userId, itemId);
    expect(second).toEqual({ ok: false, reason: 'already_owned' });
  });

  test("fails with not_found for a nonexistent item", async () => {
    const result = await VanitiesDB.buyItem(userId, 999999999);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});
