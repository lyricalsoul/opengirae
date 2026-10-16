import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users, userProfiles, linkedAccounts } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";

describe("UsersDB.unlinkAllExcept", () => {
  let fx: TestFixtures;
  let mainId: number;
  let telegramId: string;
  let newSecondaryIds: number[];

  beforeEach(async () => {
    fx = new TestFixtures();
    newSecondaryIds = [];

    const main = await fx.user({ displayName: "Pre-Update Merged", platform: 'telegram' });
    mainId = main.id;
    telegramId = main.platformId;
    await db.update(users).set({ coins: 500 }).where(eq(users.id, mainId));

    fx.onCleanup(async () => {
      for (const id of newSecondaryIds) {
        await db.delete(userProfiles).where(eq(userProfiles.userId, id));
        await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, id));
        await db.delete(users).where(eq(users.id, id));
      }
    });
  });

  afterEach(() => fx.cleanup());

  test("not_found when the (platform, platformId) isn't linked to anyone", async () => {
    const result = await UsersDB.unlinkAllExcept('telegram', `nobody-${Date.now()}`);
    expect(result.ok).toBe(false);
  });

  test("no other linked accounts - nothing to separate, main untouched", async () => {
    const result = await UsersDB.unlinkAllExcept('telegram', telegramId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mainUserId).toBe(mainId);
    expect(result.separatedAccounts).toHaveLength(0);

    const [mainUser] = await db.select().from(users).where(eq(users.id, mainId));
    expect(mainUser!.coins).toBe(500);
  });

  test("spins off every other linked account into a brand-new empty user, keeps main's coins untouched", async () => {
    const discordId = `extra-discord-${Date.now()}`;
    await db.insert(linkedAccounts).values({ userId: mainId, platform: 'discord', platformId: discordId });

    const result = await UsersDB.unlinkAllExcept('telegram', telegramId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.separatedAccounts).toHaveLength(1);
    expect(result.separatedAccounts[0]!.platform).toBe('discord');
    expect(result.separatedAccounts[0]!.platformId).toBe(discordId);
    const newId = result.separatedAccounts[0]!.newUserId;
    newSecondaryIds.push(newId);

    // the kept (telegram) account's own row keeps everything it already had - not a mint, not a split.
    const [mainUser] = await db.select().from(users).where(eq(users.id, mainId));
    expect(mainUser!.coins).toBe(500);

    // the spun-off account is brand new and empty, not a copy of main's holdings.
    const [newUser] = await db.select().from(users).where(eq(users.id, newId));
    expect(newUser!.coins).toBe(0);
    expect(newUser!.id).not.toBe(mainId);

    const [newProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, newId));
    expect(newProfile).toBeDefined();

    const [movedLink] = await db.select().from(linkedAccounts).where(eq(linkedAccounts.platformId, discordId));
    expect(movedLink!.userId).toBe(newId);

    // the kept platform's own link never moved.
    const [keptLink] = await db.select().from(linkedAccounts).where(eq(linkedAccounts.platformId, telegramId));
    expect(keptLink!.userId).toBe(mainId);
  });

  test("separates multiple other linked accounts independently", async () => {
    const discordId = `extra-discord-${Date.now()}`;
    const oldTelegramId = `extra-telegram-${Date.now()}`;
    await db.insert(linkedAccounts).values([
      { userId: mainId, platform: 'discord', platformId: discordId },
      { userId: mainId, platform: 'telegram', platformId: oldTelegramId },
    ]);

    const result = await UsersDB.unlinkAllExcept('telegram', telegramId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.separatedAccounts).toHaveLength(2);
    newSecondaryIds.push(...result.separatedAccounts.map(a => a.newUserId));

    // each spun-off account is its own distinct new row, not sharing one.
    expect(new Set(result.separatedAccounts.map(a => a.newUserId)).size).toBe(2);
  });
});
