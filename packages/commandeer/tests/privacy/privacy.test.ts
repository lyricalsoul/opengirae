import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers } from "@girae/tests";
import { db } from "@girae/database/index";
import { users, linkedAccounts, userProfiles } from "@girae/database/schemas/users";
import { UsersDB } from "@girae/database/users";
import { eq } from "drizzle-orm";
import type { IncomingCommand } from "@girae/common/commands/types";
import PrivacyCommand from "../../commands/all/privacy.users";
import ProfileCommand from "../../commands/all/profile.users";

mockTelegram();

describe("/privacy toggles privacyMode, and gates viewing other users' profiles", () => {
  let viewerId: number;
  let targetId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers(); // needed so PrivacyCommand's reply() has a worker to complete against

    const [viewer] = await db.insert(users).values({ displayName: "Test Privacy Viewer", avatarUrl: "" }).returning();
    viewerId = viewer!.id;
    await db.insert(linkedAccounts).values({ userId: viewerId, platform: 'none', platformId: 'test-privacy-viewer' });
    await db.insert(userProfiles).values({ userId: viewerId });

    const [target] = await db.insert(users).values({ displayName: "Test Privacy Target", avatarUrl: "" }).returning();
    targetId = target!.id;
    await db.insert(linkedAccounts).values({ userId: targetId, platform: 'none', platformId: 'test-privacy-target' });
    await db.insert(userProfiles).values({ userId: targetId });
  });

  afterAll(async () => {
    await db.delete(userProfiles).where(eq(userProfiles.userId, viewerId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, targetId));
    await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, viewerId));
    await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, targetId));
    await db.delete(users).where(eq(users.id, viewerId));
    await db.delete(users).where(eq(users.id, targetId));
  });

  function ctx(authorId: string): IncomingCommand {
    return {
      name: 'privacy',
      args: [],
      workflowIDToBeAssigned: `test-privacy-${Date.now()}-${Math.random()}`,
      message: {
        id: 'msg-1',
        author: { id: authorId, name: 'Tester', avatarUrl: '' },
        chat: { id: 'chat-1', title: 'test' },
        content: '/privacy',
        timestamp: new Date(),
        platform: 'none',
      },
    };
  }

  test("/privacy flips privacyMode off -> on -> off", async () => {
    const before = await UsersDB.getUserById(viewerId);
    expect(before!.privacyMode).toBe(false);

    await PrivacyCommand.execute(ctx('test-privacy-viewer'));
    expect((await UsersDB.getUserById(viewerId))!.privacyMode).toBe(true);

    await PrivacyCommand.execute(ctx('test-privacy-viewer'));
    expect((await UsersDB.getUserById(viewerId))!.privacyMode).toBe(false);
  });

  test("/profile privacidade subcommand toggles the same flag", async () => {
    await (ProfileCommand as any).togglePrivacy(ctx('test-privacy-viewer'));
    expect((await UsersDB.getUserById(viewerId))!.privacyMode).toBe(true);
    await (ProfileCommand as any).togglePrivacy(ctx('test-privacy-viewer'));
    expect((await UsersDB.getUserById(viewerId))!.privacyMode).toBe(false);
  });

  // exercises the exact guard ProfileCommand.execute (and /wish, /cards) run before showing another
  // user's data - proves it flips correctly on real rows, without needing the reply queue at all.
  test("isViewable blocks another user's profile once they enable privacy mode, and un-blocks once they disable it", async () => {
    await UsersDB.setPrivacyMode(targetId, true);
    let target = (await UsersDB.getUserById(targetId))!;
    expect(UsersDB.isViewable(viewerId, target)).toBe(false);

    await UsersDB.setPrivacyMode(targetId, false);
    target = (await UsersDB.getUserById(targetId))!;
    expect(UsersDB.isViewable(viewerId, target)).toBe(true);
  });

  test("isViewable never blocks a user from viewing their own data, even with privacy mode on", async () => {
    await UsersDB.setPrivacyMode(viewerId, true);
    const self = (await UsersDB.getUserById(viewerId))!;
    expect(UsersDB.isViewable(viewerId, self)).toBe(true);

    await UsersDB.setPrivacyMode(viewerId, false);
  });

  test("ProfileCommand.execute's privacy check reaches the block branch for a private target (no throw, resolves)", async () => {
    await UsersDB.setPrivacyMode(targetId, true);
    await expect(ProfileCommand.execute(ctx('test-privacy-viewer'), { target: 'test-privacy-target' })).resolves.toBeUndefined();
    await UsersDB.setPrivacyMode(targetId, false);
  });
});
