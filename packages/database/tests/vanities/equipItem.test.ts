import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userProfiles } from "../../schemas/users";
import { boughtItems } from "../../schemas/vanities";
import { eq } from "drizzle-orm";
import { VanitiesDB } from "../../vanities";

describe("VanitiesDB.equipItem", () => {
  const fx = new TestFixtures();
  let userId: number;
  let itemId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Equip" })).id;
    itemId = (await fx.storeItem({ title: `Test Equip Item ${Date.now()}`, type: 'background', price: 0 })).id;
  });

  afterAll(() => fx.cleanup());

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
