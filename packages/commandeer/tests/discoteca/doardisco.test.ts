import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "@girae/database/index";
import { userDiscoteca } from "@girae/database/schemas/discoteca";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq, and, inArray } from "drizzle-orm";
import DoarDiscoCommand from "../../commands/discoteca/doardisco";

const { sentMessages } = mockTelegram();

describe("/doardisco (and its alias /micardisco) donate discoteca entries as a one-sided transfer", () => {
  const fx = new TestFixtures();
  const donorPlatformId = "test-doardisco-donor";
  const recipientPlatformId = "test-doardisco-recipient";
  let donorId: number, recipientId: number;
  let entryAId: number, entryBId: number, entryCId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    donorId = (await fx.user({ displayName: "Test DoarDisco Donor", platform: 'telegram', platformId: donorPlatformId })).id;
    recipientId = (await fx.user({ displayName: "Test DoarDisco Recipient", platform: 'telegram', platformId: recipientPlatformId })).id;

    entryAId = (await fx.discotecaEntry({ name: `Test DoarDisco Entry A ${Date.now()}` })).id;
    entryBId = (await fx.discotecaEntry({ name: `Test DoarDisco Entry B ${Date.now()}` })).id;
    entryCId = (await fx.discotecaEntry({ name: `Test DoarDisco Entry C ${Date.now()}` })).id;

    fx.onCleanup(async () => {
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, donorId));
      await db.delete(userDiscoteca).where(inArray(userDiscoteca.userId, [donorId, recipientId]));
    });
  });

  afterAll(() => fx.cleanup());

  function runCtx(args: string[], workflowID: string) {
    return fakeCtx({ name: 'doardisco', authorId: donorPlatformId, args, platform: 'telegram', workflowID });
  }

  async function ownedCount(userId: number, entryId: number): Promise<number> {
    const [row] = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
    return row?.count ?? 0;
  }

  async function own(userId: number, entryId: number, count: number) {
    // upsert, not a plain insert - the self-donation test below returns early (no executeDonation call), so its row would otherwise collide with a later own() on the same id.
    await db.insert(userDiscoteca).values({ userId, entryId, count })
      .onConflictDoUpdate({ target: [userDiscoteca.userId, userDiscoteca.entryId], set: { count } });
  }

  async function runToConfirm(args: string[]) {
    const workflowID = `test-doardisco-${Bun.randomUUIDv7()}`;
    const ctx = runCtx(args, workflowID);
    const handle = await DBOS.startWorkflow(DoarDiscoCommand, { workflowID }).execute(ctx, { target: recipientPlatformId, entriesRaw: args.join(' ') });
    await new Promise(r => setTimeout(r, 500));
    return { workflowID, handle };
  }

  test("donates a single entry by ID", async () => {
    await own(donorId, entryAId, 1);
    const { workflowID, handle } = await runToConfirm([String(entryAId)]);
    await DBOS.send(workflowID, { value: true }, 'doardisco:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, entryAId)).toBe(0);
    expect(await ownedCount(recipientId, entryAId)).toBe(1);
  });

  test("donates a single entry by fuzzy name", async () => {
    await own(donorId, entryBId, 1);
    const { workflowID, handle } = await runToConfirm([`Test DoarDisco Entry B`]);
    await DBOS.send(workflowID, { value: true }, 'doardisco:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, entryBId)).toBe(0);
    expect(await ownedCount(recipientId, entryBId)).toBe(1);
  });

  test("donates multiple entries by ID in one command, skipping ones not owned", async () => {
    await own(donorId, entryAId, 1);
    const { workflowID, handle } = await runToConfirm([String(entryAId), String(entryCId), '999999']);
    await DBOS.send(workflowID, { value: true }, 'doardisco:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, entryAId)).toBe(0);
    expect(await ownedCount(recipientId, entryAId)).toBe(2);
    expect(await ownedCount(recipientId, entryCId)).toBe(0);
  });

  test("a repeated ID donates that many copies, and the confirmation prompt totals the quantity", async () => {
    await own(donorId, entryAId, 2);
    const recipientCountBefore = await ownedCount(recipientId, entryAId);
    const startIndex = sentMessages.length;
    const { workflowID, handle } = await runToConfirm([String(entryAId), String(entryAId)]);

    const confirmPrompt = sentMessages.slice(startIndex).find(m => typeof m.text === 'string' && m.text.includes('Doar'));
    expect(confirmPrompt).toBeDefined();
    expect(confirmPrompt!.text).toInclude('Doar <strong>2</strong> item(ns)');

    await DBOS.send(workflowID, { value: true }, 'doardisco:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, entryAId)).toBe(0);
    expect(await ownedCount(recipientId, entryAId)).toBe(recipientCountBefore + 2);
  });

  test("* donates the donor's entire discoteca, full counts included", async () => {
    const bulkDonorPlatformId = "test-doardisco-bulk-donor";
    const bulkDonorId = (await fx.user({ displayName: "Test DoarDisco Bulk Donor", platform: 'telegram', platformId: bulkDonorPlatformId })).id;
    fx.onCleanup(async () => {
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, bulkDonorId));
      await db.delete(userDiscoteca).where(eq(userDiscoteca.userId, bulkDonorId));
    });
    await own(bulkDonorId, entryAId, 4);
    await own(bulkDonorId, entryBId, 2);

    const workflowID = `test-doardisco-star-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'doardisco', authorId: bulkDonorPlatformId, args: ['*'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(DoarDiscoCommand, { workflowID }).execute(ctx, { target: recipientPlatformId, entriesRaw: '*' });
    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: true }, 'doardisco:confirm');
    await handle.getResult();

    expect(await ownedCount(bulkDonorId, entryAId)).toBe(0);
    expect(await ownedCount(bulkDonorId, entryBId)).toBe(0);
    expect(await ownedCount(recipientId, entryAId)).toBeGreaterThanOrEqual(4);
    expect(await ownedCount(recipientId, entryBId)).toBeGreaterThanOrEqual(2);
  });

  test("donating to yourself replies without throwing and moves nothing", async () => {
    await own(donorId, entryAId, 1);
    const ctx = fakeCtx({ name: 'doardisco', authorId: donorPlatformId, args: [String(entryAId)], platform: 'telegram' });
    await DoarDiscoCommand.execute(ctx, { target: donorPlatformId, entriesRaw: String(entryAId) });
    expect(await ownedCount(donorId, entryAId)).toBe(1);
  });

  test("a TOCTOU race: donor loses the entry between the confirm prompt and the click", async () => {
    await own(donorId, entryAId, 1);
    const recipientCountBefore = await ownedCount(recipientId, entryAId);
    const { workflowID, handle } = await runToConfirm([String(entryAId)]);

    await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, donorId), eq(userDiscoteca.entryId, entryAId)));

    await DBOS.send(workflowID, { value: true }, 'doardisco:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, entryAId)).toBe(0);
    expect(await ownedCount(recipientId, entryAId)).toBe(recipientCountBefore);
  });
});
