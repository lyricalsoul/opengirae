import { test, expect, describe, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { linkedAccounts } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";

describe("UsersDB platform-account methods", () => {
  const fx = new TestFixtures();

  afterAll(() => fx.cleanup());

  test("ensureUser creates a new user + profile + linked_account on first call", async () => {
    const { id, platformId } = await fx.user({ displayName: "Test User", platform: 'telegram' });

    const links = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, id));
    expect(links).toHaveLength(1);
    expect(links[0]!.platform).toBe('telegram');
    expect(links[0]!.platformId).toBe(platformId);

    const profile = await UsersDB.getUserProfileByPlatformAccount('telegram', platformId);
    expect(profile).toBeDefined();
  });

  test("ensureUser is idempotent for the same platform account", async () => {
    const { id, platform, platformId } = await fx.user({ displayName: "A", platform: 'discord' });
    const second = await UsersDB.ensureUser({ platform, platformId, displayName: "A", avatarUrl: "" });

    expect(second!.id).toBe(id);
    const links = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, id));
    expect(links).toHaveLength(1);
  });

  test("getUserByPlatformAccount resolves through linked_accounts", async () => {
    const { id, platformId } = await fx.user({ displayName: "Lookup", platform: 'telegram' });

    const found = await UsersDB.getUserByPlatformAccount('telegram', platformId);
    expect(found?.id).toBe(id);

    const wrongPlatform = await UsersDB.getUserByPlatformAccount('discord', platformId);
    expect(wrongPlatform).toBeUndefined();
  });

  test("getUserProfileByPlatformAccount joins user + profile", async () => {
    const { id, platformId } = await fx.user({ displayName: "Profile", platform: 'telegram' });

    const row = await UsersDB.getUserProfileByPlatformAccount('telegram', platformId);
    expect(row?.users.id).toBe(id);
    expect(row?.user_profiles.userId).toBe(id);
  });

  test("touchUsername updates displayName only when changed, scoped by platform", async () => {
    const { platformId } = await fx.user({ displayName: "Old Name", platform: 'telegram' });

    await UsersDB.touchUsername('telegram', platformId, undefined, "New Name");
    const updated = await UsersDB.getUserByPlatformAccount('telegram', platformId);
    expect(updated?.displayName).toBe("New Name");

    // same platformId under 'discord' must not match - proves the join is platform-scoped
    await UsersDB.touchUsername('discord', platformId, undefined, "Should Not Apply");
    const stillNew = await UsersDB.getUserByPlatformAccount('telegram', platformId);
    expect(stillNew?.displayName).toBe("New Name");
  });
});
