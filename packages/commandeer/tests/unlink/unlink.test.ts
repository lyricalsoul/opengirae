import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users, userProfiles, linkedAccounts } from "@girae/database/schemas/users";
import { userCards, wishlist } from "@girae/database/schemas/cards";
import { boughtItems } from "@girae/database/schemas/vanities";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";
import { UsersDB } from "@girae/database/users";
import UnlinkCommand from "../../commands/admin/unlink";

mockTelegram();

// Wiring-level coverage for /unlink - UsersDB.undoLastMergeForUser's own reversal logic
// (clamping, marriages, shortfalls) is covered exhaustively in
// packages/database/tests/users/undoLastMergeForUser.test.ts. This just proves the command
// resolves staff/target correctly and actually calls through to it.
describe("/unlink undoes a target's most recent /link", () => {
  const fx = new TestFixtures();
  const staffPlatformId = "test-unlink-cmd-staff";
  const mainPlatformId = "test-unlink-cmd-main";
  let staffId: number, mainId: number, secondaryId: number, secondaryPlatformId: string;
  let newSecondaryId: number | undefined;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    staffId = (await fx.user({ displayName: "Test Unlink Cmd Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    mainId = (await fx.user({ displayName: "Test Unlink Cmd Main", platform: 'telegram', platformId: mainPlatformId })).id;
    const secondary = await fx.user({ displayName: "Test Unlink Cmd Secondary", platform: 'discord' });
    secondaryId = secondary.id;
    secondaryPlatformId = secondary.platformId;
    await db.update(users).set({ coins: 200 }).where(eq(users.id, mainId));
    await db.update(users).set({ coins: 40 }).where(eq(users.id, secondaryId));

    await UsersDB.mergeUsers(mainId, secondaryId);

    fx.onCleanup(async () => {
      // mergeUsers logs 'users.merge' (actorUserId: mainId) and undoLastMergeForUser logs
      // 'users.unlink' (actorUserId: staffId) - both would otherwise FK-block deleting those rows.
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, mainId));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId));
      if (newSecondaryId === undefined) return;
      await db.delete(userCards).where(eq(userCards.userId, newSecondaryId));
      await db.delete(wishlist).where(eq(wishlist.userId, newSecondaryId));
      await db.delete(boughtItems).where(eq(boughtItems.userId, newSecondaryId));
      await db.delete(userProfiles).where(eq(userProfiles.userId, newSecondaryId));
      await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, newSecondaryId));
      await db.delete(users).where(eq(users.id, newSecondaryId));
    });
  });

  afterAll(() => fx.cleanup());

  function ctx(args: string[]) {
    return fakeCtx({ name: 'unlink', authorId: staffPlatformId, args, platform: 'telegram' });
  }

  test("resolves the target by mention and reverses their merge", async () => {
    await UnlinkCommand.execute(ctx(['unlink', mainPlatformId]), { target: mainPlatformId });

    const [mainUser] = await db.select().from(users).where(eq(users.id, mainId));
    expect(mainUser!.coins).toBe(200); // 240 merged, all 40 clawed back

    const [discordLink] = await db.select().from(linkedAccounts).where(eq(linkedAccounts.platformId, secondaryPlatformId));
    expect(discordLink).toBeDefined();
    expect(discordLink!.userId).not.toBe(mainId); // moved off of main onto the resurrected account
    newSecondaryId = discordLink!.userId;

    const [resurrected] = await db.select().from(users).where(eq(users.id, newSecondaryId));
    expect(resurrected!.coins).toBe(40);
  });

  test("a second /unlink on the same (already-undone) target finds nothing pending", async () => {
    await UnlinkCommand.execute(ctx(['unlink', mainPlatformId]), { target: mainPlatformId });
    // no throw, no DB state change to assert beyond "didn't crash" - undoLastMergeForUser's own
    // 'no_pending_merge' path is covered directly in the DB-layer test suite.
  });

  test("an unknown target is refused without throwing", async () => {
    await UnlinkCommand.execute(ctx(['unlink', '999999999']), { target: '999999999' });
  });
});
