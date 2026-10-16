import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "@girae/database/index";
import { users, userProfiles, linkedAccounts } from "@girae/database/schemas/users";
import { userCards, wishlist } from "@girae/database/schemas/cards";
import { boughtItems } from "@girae/database/schemas/vanities";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq, inArray } from "drizzle-orm";
import { UsersDB } from "@girae/database/users";
import UnlinkCommand from "../../commands/admin/unlink";

mockTelegram();

const STAFF_GROUP_CHAT_ID = '-1004377125716';

// Drives a workflow command past its first DBOS.recv, same pattern docs/agent/03-commands.md describes for /hipoteca.
async function runUnlinkAndChooseMode(ctx: ReturnType<typeof fakeCtx>, args: { target: string }, mode: 'after' | 'before') {
  const handle = await DBOS.startWorkflow(UnlinkCommand, { workflowID: ctx.workflowIDToBeAssigned }).execute(ctx, args);
  await new Promise(r => setTimeout(r, 500));
  await DBOS.send(ctx.workflowIDToBeAssigned, { value: mode }, 'unlink:mode');
  await handle.getResult();
}

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
    await runUnlinkAndChooseMode(ctx(['unlink', mainPlatformId]), { target: mainPlatformId }, 'after');

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
    await runUnlinkAndChooseMode(ctx(['unlink', mainPlatformId]), { target: mainPlatformId }, 'after');
    // no throw, no DB state change to assert beyond "didn't crash" - undoLastMergeForUser's own
    // 'no_pending_merge' path is covered directly in the DB-layer test suite.
  });

  test("an unknown target is refused without throwing", async () => {
    await UnlinkCommand.execute(ctx(['unlink', '999999999']), { target: '999999999' });
  });
});

// "Antes da atualização" path - no audit snapshot, so it hands everything to the mentioned account instead of splitting; gated to the staff group chat.
describe("/unlink 'antes da atualização' hands everything to the mentioned account", () => {
  const fx = new TestFixtures();
  const staffPlatformId = "test-unlink-before-staff";
  const mainPlatformId = "test-unlink-before-main";
  let staffId: number, mainId: number;
  let extraDiscordId: string;
  let newIdsToClean: number[] = [];

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    staffId = (await fx.user({ displayName: "Test Unlink Before Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    mainId = (await fx.user({ displayName: "Test Unlink Before Main", platform: 'telegram', platformId: mainPlatformId })).id;
    await db.update(users).set({ coins: 300 }).where(eq(users.id, mainId));

    extraDiscordId = `test-unlink-before-extra-${Date.now()}`;
    await db.insert(linkedAccounts).values({ userId: mainId, platform: 'discord', platformId: extraDiscordId });

    fx.onCleanup(async () => {
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId));
      if (newIdsToClean.length === 0) return;
      await db.delete(userProfiles).where(inArray(userProfiles.userId, newIdsToClean));
      await db.delete(linkedAccounts).where(inArray(linkedAccounts.userId, newIdsToClean));
      await db.delete(users).where(inArray(users.id, newIdsToClean));
    });
  });

  afterAll(() => fx.cleanup());

  function ctx(chatId: string) {
    return fakeCtx({ name: 'unlink', authorId: staffPlatformId, args: ['unlink', mainPlatformId], platform: 'telegram', chatId });
  }

  test("refuses outside the staff group chat, main stays merged", async () => {
    await runUnlinkAndChooseMode(ctx('some-other-chat'), { target: mainPlatformId }, 'before');

    const links = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, mainId));
    expect(links).toHaveLength(2); // nothing separated
  });

  test("in the staff group: separates the other account, keeps everything on the mentioned one", async () => {
    await runUnlinkAndChooseMode(ctx(STAFF_GROUP_CHAT_ID), { target: mainPlatformId }, 'before');

    const [mainUser] = await db.select().from(users).where(eq(users.id, mainId));
    expect(mainUser!.coins).toBe(300); // untouched - not a split, not a mint

    const [movedLink] = await db.select().from(linkedAccounts).where(eq(linkedAccounts.platformId, extraDiscordId));
    expect(movedLink!.userId).not.toBe(mainId);
    newIdsToClean.push(movedLink!.userId);

    const [newUser] = await db.select().from(users).where(eq(users.id, movedLink!.userId));
    expect(newUser!.coins).toBe(0);
  });
});
