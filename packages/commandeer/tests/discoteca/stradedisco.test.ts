import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "@girae/database/index";
import { userDiscoteca } from "@girae/database/schemas/discoteca";
import { trades } from "@girae/database/schemas/cards";
import { eq, and, or, inArray } from "drizzle-orm";
import { DiscotecaDB } from "@girae/database/discoteca";
import SimpleTradeDiscoCommand from "../../commands/discoteca/stradedisco";

mockTelegram();

describe("/stradedisco", () => {
  const fx = new TestFixtures();
  const proposerPlatformId = "test-stradedisco-proposer";
  const targetPlatformId = "test-stradedisco-target";
  let proposerId: number, targetId: number;
  let entryAId: number, entryBId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    proposerId = (await fx.user({ displayName: "Test Stradedisco Proposer", platform: 'telegram', platformId: proposerPlatformId })).id;
    targetId = (await fx.user({ displayName: "Test Stradedisco Target", platform: 'telegram', platformId: targetPlatformId })).id;

    entryAId = (await fx.discotecaEntry({ name: `Test Stradedisco Entry A ${Date.now()}` })).id;
    entryBId = (await fx.discotecaEntry({ name: `Test Stradedisco Entry B ${Date.now()}` })).id;
  });

  afterAll(async () => {
    // executeMixedTrade inserts a trades row - delete it first, or fx.cleanup()'s user delete fails on the trades FK.
    await db.delete(trades).where(or(eq(trades.user1Id, proposerId), eq(trades.user2Id, proposerId)));
    await fx.cleanup();
  });

  async function ownedCount(userId: number, entryId: number): Promise<number> {
    const [row] = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
    return row?.count ?? 0;
  }

  test("both sides tradable: confirming (as target) swaps the two entries", async () => {
    await db.insert(userDiscoteca).values([
      { userId: proposerId, entryId: entryAId, count: 1, tradable: true },
      { userId: targetId, entryId: entryBId, count: 1, tradable: true },
    ]);

    const myEntry = (await DiscotecaDB.getEntryWithDetails(entryAId))!;
    const theirEntry = (await DiscotecaDB.getEntryWithDetails(entryBId))!;

    const workflowID = `test-stradedisco-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'stradedisco', authorId: proposerPlatformId, platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(SimpleTradeDiscoCommand, { workflowID })
      .execute(ctx, { target: targetPlatformId, myEntry, theirEntry });

    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: 'confirm', clickerUserId: targetPlatformId }, 'stradedisco:confirm');
    await handle.getResult();

    expect(await ownedCount(proposerId, entryBId)).toBe(1);
    expect(await ownedCount(targetId, entryAId)).toBe(1);
    expect(await ownedCount(proposerId, entryAId)).toBe(0);
    expect(await ownedCount(targetId, entryBId)).toBe(0);
  });

  test("target's entry isn't marked tradable: replies without throwing and swaps nothing", async () => {
    await db.insert(userDiscoteca).values([
      { userId: proposerId, entryId: entryAId, count: 1, tradable: true },
      { userId: targetId, entryId: entryBId, count: 1, tradable: false },
    ]);

    const myEntry = (await DiscotecaDB.getEntryWithDetails(entryAId))!;
    const theirEntry = (await DiscotecaDB.getEntryWithDetails(entryBId))!;

    const ctx = fakeCtx({ name: 'stradedisco', authorId: proposerPlatformId, platform: 'telegram' });
    await SimpleTradeDiscoCommand.execute(ctx, { target: targetPlatformId, myEntry, theirEntry });

    expect(await ownedCount(proposerId, entryAId)).toBe(1);
    expect(await ownedCount(targetId, entryBId)).toBe(1);

    await db.delete(userDiscoteca).where(and(inArray(userDiscoteca.userId, [proposerId, targetId]), inArray(userDiscoteca.entryId, [entryAId, entryBId])));
  });
});
