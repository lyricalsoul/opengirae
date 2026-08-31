import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users, userProfiles } from "../../schemas/users";
import { boughtItems } from "../../schemas/vanities";
import { eq } from "drizzle-orm";
import { VanitiesDB, REFUND_WINDOW_MS } from "../../vanities";
import { EconomyDB } from "../../economy";

describe("VanitiesDB.refundItem / getRefundableItems", () => {
  const fx = new TestFixtures();
  let userId: number;
  let itemId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Refund" })).id;
    itemId = (await fx.storeItem({ title: `Test Refund Item ${Date.now()}`, type: 'background', price: 100 })).id;
  });

  afterAll(() => fx.cleanup());

  beforeEach(async () => {
    await db.delete(boughtItems).where(eq(boughtItems.itemId, itemId));
    await db.update(users).set({ coins: 1000, treasuryContributed: 0 }).where(eq(users.id, userId));
    await db.update(userProfiles).set({ equipedBackgroundId: null, equipedStickerId: null }).where(eq(userProfiles.userId, userId));
  });

  test("refunds coins, removes ownership, and reverses the treasury credit within the window", async () => {
    const beforeTreasury = await EconomyDB.getState();
    await VanitiesDB.buyItem(userId, itemId);

    const result = await VanitiesDB.refundItem(userId, itemId);
    expect(result).toEqual({ ok: true, title: (await VanitiesDB.getStoreItemById(itemId))!.title, refundedPrice: 100 });

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(1000);
    expect(user!.treasuryContributed).toBe(0);

    const afterTreasury = await EconomyDB.getState();
    expect(afterTreasury.treasuryBalance).toBe(beforeTreasury.treasuryBalance);

    const owned = await db.select().from(boughtItems).where(eq(boughtItems.itemId, itemId));
    expect(owned).toHaveLength(0);
  });

  test("un-equips the item if it was equipped", async () => {
    await VanitiesDB.buyItem(userId, itemId);
    await VanitiesDB.equipItem(userId, 'background', itemId);

    await VanitiesDB.refundItem(userId, itemId);

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    expect(profile!.equipedBackgroundId).toBeNull();
  });

  test("fails with not_refundable once the 1h window has passed, and changes nothing", async () => {
    await VanitiesDB.buyItem(userId, itemId);
    const expiredBoughtAt = new Date(Date.now() - REFUND_WINDOW_MS - 60_000);
    await db.update(boughtItems).set({ boughtAt: expiredBoughtAt }).where(eq(boughtItems.itemId, itemId));

    const result = await VanitiesDB.refundItem(userId, itemId);
    expect(result).toEqual({ ok: false, reason: 'not_refundable' });

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(900);

    const owned = await db.select().from(boughtItems).where(eq(boughtItems.itemId, itemId));
    expect(owned).toHaveLength(1);
  });

  test("fails with not_refundable when nothing was ever bought", async () => {
    const result = await VanitiesDB.refundItem(userId, itemId);
    expect(result).toEqual({ ok: false, reason: 'not_refundable' });
  });

  test("getRefundableItems only returns items still inside the window", async () => {
    await VanitiesDB.buyItem(userId, itemId);
    const within = await VanitiesDB.getRefundableItems(userId);
    expect(within.map(i => i.id)).toContain(itemId);

    const expiredBoughtAt = new Date(Date.now() - REFUND_WINDOW_MS - 60_000);
    await db.update(boughtItems).set({ boughtAt: expiredBoughtAt }).where(eq(boughtItems.itemId, itemId));

    const afterExpiry = await VanitiesDB.getRefundableItems(userId);
    expect(afterExpiry.map(i => i.id)).not.toContain(itemId);
  });
});
