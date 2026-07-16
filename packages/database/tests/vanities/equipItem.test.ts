import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users, userProfiles } from "../../schemas/users";
import { storeItems, boughtItems } from "../../schemas/vanities";
import { eq } from "drizzle-orm";
import { VanitiesDB } from "../../vanities";

describe("VanitiesDB.equipItem", () => {
  let userId: number;
  let itemId: number;

  beforeAll(async () => {
    const [user] = await db.insert(users).values({
      telegramId: `test-equipitem-${Date.now()}`, displayName: "Test Equip", avatarUrl: "",
    }).returning();
    userId = user!.id;
    await db.insert(userProfiles).values({ userId });

    const [item] = await db.insert(storeItems).values({
      title: `Test Equip Item ${Date.now()}`, description: "test", type: "background", price: 0, itemURL: "https://example.com/x.png",
    }).returning();
    itemId = item!.id;
  });

  afterAll(async () => {
    await db.delete(boughtItems).where(eq(boughtItems.itemId, itemId));
    await db.delete(storeItems).where(eq(storeItems.id, itemId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  test("fails with not_owned if the user hasn't bought the item", async () => {
    const result = await VanitiesDB.equipItem(userId, 'background', itemId);
    expect(result).toEqual({ ok: false, reason: 'not_owned' });
  });

  test("equips the item once owned", async () => {
    await db.insert(boughtItems).values({ userId, itemId });

    const result = await VanitiesDB.equipItem(userId, 'background', itemId);
    expect(result.ok).toBe(true);

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    expect(profile!.equipedBackgroundId).toBe(itemId);
  });
});
