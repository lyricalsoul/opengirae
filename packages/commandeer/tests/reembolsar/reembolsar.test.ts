import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { VanitiesDB, REFUND_WINDOW_MS } from "@girae/database/vanities";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { boughtItems } from "@girae/database/schemas/vanities";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";
import ReembolsarCommand from "../../commands/vanity/reembolsar";

mockTelegram();

describe("/reembolsar refunds a store purchase made within the last 1h", () => {
  const fx = new TestFixtures();
  const authorPlatformId = "test-reembolsar-author";
  let userId: number;
  let itemId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    userId = (await fx.user({ displayName: "Test Reembolsar", platform: 'telegram', platformId: authorPlatformId })).id;
    itemId = (await fx.storeItem({ title: `Test Reembolsar Item ${Date.now()}`, type: 'background', price: 100 })).id;

    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, userId)); });
  });

  afterAll(() => fx.cleanup());

  beforeEach(async () => {
    await db.delete(boughtItems).where(eq(boughtItems.itemId, itemId));
    await db.update(users).set({ coins: 1000, treasuryContributed: 0 }).where(eq(users.id, userId));
  });

  function runCtx(args: string[], workflowID: string) {
    return fakeCtx({ name: 'reembolsar', authorId: authorPlatformId, args, platform: 'telegram', workflowID });
  }

  async function runToConfirm(itemIdArg?: number) {
    const workflowID = `test-reembolsar-${Bun.randomUUIDv7()}`;
    const ctx = runCtx(itemIdArg !== undefined ? [String(itemIdArg)] : [], workflowID);
    const handle = await DBOS.startWorkflow(ReembolsarCommand, { workflowID }).execute(ctx, { itemId: itemIdArg });
    await new Promise(r => setTimeout(r, 500));
    return { workflowID, handle };
  }

  test("confirming refunds the coins and removes ownership", async () => {
    await VanitiesDB.buyItem(userId, itemId);
    const { workflowID, handle } = await runToConfirm(itemId);

    await DBOS.send(workflowID, { value: true }, 'reembolsar:confirm');
    await handle.getResult();

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(1000);

    const owned = await db.select().from(boughtItems).where(eq(boughtItems.itemId, itemId));
    expect(owned).toHaveLength(0);
  });

  test("cancelling leaves the purchase untouched", async () => {
    await VanitiesDB.buyItem(userId, itemId);
    const { workflowID, handle } = await runToConfirm(itemId);

    await DBOS.send(workflowID, { value: false }, 'reembolsar:confirm');
    await handle.getResult();

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(900);
  });

  test("no args lists refundable purchases without throwing", async () => {
    await VanitiesDB.buyItem(userId, itemId);
    const ctx = runCtx([], `test-reembolsar-list-${Bun.randomUUIDv7()}`);
    await ReembolsarCommand.execute(ctx, { itemId: undefined }); // no throw = pass; see 03-commands.md on why not asserting reply content
  });

  test("an unknown item id replies without throwing and changes nothing", async () => {
    const { workflowID, handle } = await runToConfirm(999999999);
    await handle.getResult();

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(1000);
  });

  test("a TOCTOU race: the 1h window closes between the confirm prompt and the click", async () => {
    await VanitiesDB.buyItem(userId, itemId);
    const { workflowID, handle } = await runToConfirm(itemId);

    const expiredBoughtAt = new Date(Date.now() - REFUND_WINDOW_MS - 60_000);
    await db.update(boughtItems).set({ boughtAt: expiredBoughtAt }).where(eq(boughtItems.itemId, itemId));

    await DBOS.send(workflowID, { value: true }, 'reembolsar:confirm');
    await handle.getResult();

    // the refund must not have gone through - coins stay spent, the (now-expired) row stays put
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.coins).toBe(900);
    const owned = await db.select().from(boughtItems).where(eq(boughtItems.itemId, itemId));
    expect(owned).toHaveLength(1);
  });
});
