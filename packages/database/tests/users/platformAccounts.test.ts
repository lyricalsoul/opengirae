import { test, expect, describe, afterAll } from "bun:test";
import { db } from "../../index";
import { users, userProfiles, linkedAccounts } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";

describe("UsersDB platform-account methods", () => {
  const cleanupUserIds: number[] = [];

  afterAll(async () => {
    for (const userId of cleanupUserIds) {
      await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, userId));
      await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  test("ensureUser creates a new user + profile + linked_account on first call", async () => {
    const platformId = `test-ensure-${Date.now()}`;
    const user = await UsersDB.ensureUser({ platform: 'telegram', platformId, displayName: "Test User", avatarUrl: "" });
    expect(user).not.toBeNull();
    cleanupUserIds.push(user!.id);

    const links = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, user!.id));
    expect(links).toHaveLength(1);
    expect(links[0]!.platform).toBe('telegram');
    expect(links[0]!.platformId).toBe(platformId);

    const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, user!.id));
    expect(profile).toHaveLength(1);
  });

  test("ensureUser is idempotent for the same platform account", async () => {
    const platformId = `test-ensure-idem-${Date.now()}`;
    const first = await UsersDB.ensureUser({ platform: 'discord', platformId, displayName: "A", avatarUrl: "" });
    cleanupUserIds.push(first!.id);
    const second = await UsersDB.ensureUser({ platform: 'discord', platformId, displayName: "A", avatarUrl: "" });

    expect(second!.id).toBe(first!.id);
    const links = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, first!.id));
    expect(links).toHaveLength(1);
  });

  test("getUserByPlatformAccount resolves through linked_accounts", async () => {
    const platformId = `test-lookup-${Date.now()}`;
    const created = await UsersDB.ensureUser({ platform: 'telegram', platformId, displayName: "Lookup", avatarUrl: "" });
    cleanupUserIds.push(created!.id);

    const found = await UsersDB.getUserByPlatformAccount('telegram', platformId);
    expect(found?.id).toBe(created!.id);

    const wrongPlatform = await UsersDB.getUserByPlatformAccount('discord', platformId);
    expect(wrongPlatform).toBeUndefined();
  });

  test("getUserProfileByPlatformAccount joins user + profile", async () => {
    const platformId = `test-profile-${Date.now()}`;
    const created = await UsersDB.ensureUser({ platform: 'telegram', platformId, displayName: "Profile", avatarUrl: "" });
    cleanupUserIds.push(created!.id);

    const row = await UsersDB.getUserProfileByPlatformAccount('telegram', platformId);
    expect(row?.users.id).toBe(created!.id);
    expect(row?.user_profiles.userId).toBe(created!.id);
  });

  test("touchUsername updates displayName only when changed, scoped by platform", async () => {
    const platformId = `test-touch-${Date.now()}`;
    const created = await UsersDB.ensureUser({ platform: 'telegram', platformId, displayName: "Old Name", avatarUrl: "" });
    cleanupUserIds.push(created!.id);

    await UsersDB.touchUsername('telegram', platformId, undefined, "New Name");
    const updated = await UsersDB.getUserByPlatformAccount('telegram', platformId);
    expect(updated?.displayName).toBe("New Name");

    // same platformId under 'discord' must not match - proves the join is platform-scoped
    await UsersDB.touchUsername('discord', platformId, undefined, "Should Not Apply");
    const stillNew = await UsersDB.getUserByPlatformAccount('telegram', platformId);
    expect(stillNew?.displayName).toBe("New Name");
  });
});
