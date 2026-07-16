import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { storeItems, boughtItems } from "../../schemas/vanities";
import { eq } from "drizzle-orm";
import { VanitiesDB } from "../../vanities";

describe("VanitiesDB.buyItem", () => {
  let userId: number;
  let itemId: number;

  beforeAll(async () => {
    const [user] = await db.insert(users).values({
      telegramId: `test-buyitem-${Date.now()}`, displayName: "Test Buy", avatarUrl: "", coins: 1000,
    }).returning();
    userId = user!.id;

    const [item] = await db.insert(storeItems).values({
      title: `Test Buy Item ${Date.now()}`, description: "test", type: "background", price: 100, itemURL: "https://example.com/x.png",
    }).returning();
    itemId = item!.id;
  });

  afterAll(async () => {
    await db.delete(boughtItems).where(eq(boughtItems.itemId, itemId));
    await db.delete(storeItems).where(eq(storeItems.id, itemId));
    await db.delete(users).where(eq(users.id, userId));
  });

  beforeEach(async () => {
    await db.delete(boughtItems).where(eq(boughtItems.itemId, itemId));
    await db.update(users).set({ coins: 1000 }).where(eq(users.id, userId));
  });

  test("buys the item, deducts coins, and records ownership", async () => {
    const result = await VanitiesDB.buyItem(userId, itemId);
    expect(result).toEqual({ ok: true });

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(900);

    const owned = await db.select().from(boughtItems).where(eq(boughtItems.userId, userId));
    expect(owned).toHaveLength(1);
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
