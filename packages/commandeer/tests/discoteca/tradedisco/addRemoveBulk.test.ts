import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, StandInWorkflow } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { rawClient } from "@girae/common/queue";
import { db } from "@girae/database/index";
import { userDiscoteca } from "@girae/database/schemas/discoteca";
import { eq, and, inArray } from "drizzle-orm";
import { lockKey, tryAcquireLock } from "../../../services/discoteca/tradeLock";
import AddDiscoCommand from "../../../commands/discoteca/adddisco";
import RemoveDiscoCommand from "../../../commands/discoteca/removedisco";

mockTelegram();

describe("/adddisco and /removedisco support multiple space-separated entry IDs", () => {
  const fx = new TestFixtures();
  const proposerPlatformId = "test-addremovedisco-proposer";
  const targetPlatformId = "test-addremovedisco-target";
  let proposerId: number;
  let entryAId: number, entryBId: number, entryCId: number;
  let workflowID: string;

  function stateKey() {
    return `tradedisco:state:${workflowID}`;
  }

  async function seedTradeState() {
    workflowID = `test-addremovedisco-workflow-${Bun.randomUUIDv7()}`;
    await DBOS.startWorkflow(StandInWorkflow, { workflowID }).park("tradedisco:negotiation");
    await tryAcquireLock(proposerPlatformId, { workflowID, partnerId: targetPlatformId });
    await rawClient.set(stateKey(), JSON.stringify({
      proposerTelegramId: proposerPlatformId,
      targetTelegramId: targetPlatformId,
      offers: { proposer: {}, target: {} },
      ready: { proposer: false, target: false },
      dmChat: {},
      dmMessageId: {},
    }));
  }

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    proposerId = (await fx.user({ displayName: "Test AddRemoveDisco Proposer", platform: 'telegram', platformId: proposerPlatformId })).id;
    await fx.user({ displayName: "Test AddRemoveDisco Target", platform: 'telegram', platformId: targetPlatformId });

    entryAId = (await fx.discotecaEntry({ name: `Test AddRemoveDisco Entry A ${Date.now()}` })).id;
    entryBId = (await fx.discotecaEntry({ name: `Test AddRemoveDisco Entry B ${Date.now()}` })).id;
    entryCId = (await fx.discotecaEntry({ name: `Test AddRemoveDisco Entry C ${Date.now()}` })).id;

    await db.insert(userDiscoteca).values([
      { userId: proposerId, entryId: entryAId, count: 1, tradable: true },
      { userId: proposerId, entryId: entryBId, count: 1, tradable: true },
    ]);
    fx.onCleanup(async () => { await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, proposerId), inArray(userDiscoteca.entryId, [entryAId, entryBId, entryCId]))); });
  });

  afterAll(async () => {
    await rawClient.del(lockKey(proposerPlatformId));
    if (workflowID) await rawClient.del(stateKey());
    await fx.cleanup();
  });

  function ctx(args: string[]) {
    return fakeCtx({ name: 'adddisco', authorId: proposerPlatformId, args, platform: 'telegram' });
  }

  test("with no active trade, replies without throwing and adds nothing", async () => {
    await rawClient.del(lockKey(proposerPlatformId));
    await AddDiscoCommand.execute(ctx([String(entryAId)]));
  });

  test("adds multiple entries by ID in one command, only the owned+tradable+valid ones succeed", async () => {
    await seedTradeState();
    await AddDiscoCommand.execute(ctx([String(entryAId), String(entryBId), String(entryCId), '999999']));

    const raw = await rawClient.get(stateKey());
    const state = JSON.parse(raw!);
    expect(state.offers.proposer[entryAId]).toBe(1);
    expect(state.offers.proposer[entryBId]).toBe(1);
    expect(state.offers.proposer[entryCId]).toBeUndefined();
  });

  test("removes multiple entries by ID in one command", async () => {
    await RemoveDiscoCommand.execute(ctx([String(entryAId), String(entryBId)]));

    const raw = await rawClient.get(stateKey());
    const state = JSON.parse(raw!);
    expect(state.offers.proposer[entryAId]).toBeUndefined();
    expect(state.offers.proposer[entryBId]).toBeUndefined();
  });

  test("a single non-numeric token still resolves by fuzzy name", async () => {
    await AddDiscoCommand.execute(ctx(["Test AddRemoveDisco Entry A"]));
    const raw = await rawClient.get(stateKey());
    const state = JSON.parse(raw!);
    expect(state.offers.proposer[entryAId]).toBe(1);
  });

  test("a non-tradable owned entry is skipped even by bulk ID", async () => {
    await db.insert(userDiscoteca).values({ userId: proposerId, entryId: entryCId, count: 1, tradable: false });
    await AddDiscoCommand.execute(ctx([String(entryCId)]));

    const raw = await rawClient.get(stateKey());
    const state = JSON.parse(raw!);
    expect(state.offers.proposer[entryCId]).toBeUndefined();
  });
});
