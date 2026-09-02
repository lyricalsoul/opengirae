import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, StandInWorkflow } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { rawClient } from "@girae/common/queue";
import { lockKey, tryAcquireLock } from "../../services/cards/tradeLock";
import AddCommand from "../../commands/cards/add";
import RemoveCommand from "../../commands/cards/remove";

mockTelegram();

describe("/add and /remove support multiple space-separated card IDs", () => {
  const fx = new TestFixtures();
  const proposerPlatformId = "test-addremove-proposer";
  const targetPlatformId = "test-addremove-target";
  let cardAId: number, cardBId: number, cardCId: number;
  let workflowID: string;

  function stateKey() {
    return `trade:state:${workflowID}`;
  }

  async function seedTradeState() {
    workflowID = `test-addremove-workflow-${Bun.randomUUIDv7()}`;
    await DBOS.startWorkflow(StandInWorkflow, { workflowID }).park("trade:negotiation");
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

    const proposerId = (await fx.user({ displayName: "Test AddRemove Proposer", platform: 'telegram', platformId: proposerPlatformId })).id;
    await fx.user({ displayName: "Test AddRemove Target", platform: 'telegram', platformId: targetPlatformId });

    const categoryId = (await fx.category({ name: `Test AddRemove Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test AddRemove Sub ${Date.now()}` })).id;
    cardAId = (await fx.card({ name: `Test AddRemove Card A ${Date.now()}`, subcategoryId })).id;
    cardBId = (await fx.card({ name: `Test AddRemove Card B ${Date.now()}`, subcategoryId })).id;
    cardCId = (await fx.card({ name: `Test AddRemove Card C ${Date.now()}`, subcategoryId })).id;

    await fx.ownCard(proposerId, cardAId, 1);
    await fx.ownCard(proposerId, cardBId, 1);
  });

  afterAll(async () => {
    await rawClient.del(lockKey(proposerPlatformId));
    if (workflowID) await rawClient.del(stateKey());
    await fx.cleanup();
  });

  function ctx(args: string[]) {
    return fakeCtx({ name: 'add', authorId: proposerPlatformId, args, platform: 'telegram' });
  }

  test("with no active trade, replies without throwing and adds nothing", async () => {
    await rawClient.del(lockKey(proposerPlatformId));
    // plain await, not expect(promise).resolves - the chained matcher hangs the whole file under bun test 1.3.14, see 03-commands.md
    expect(await AddCommand.execute(ctx([String(cardAId)]))).toBeUndefined();
  });

  test("adds multiple cards by ID in one command, only the owned+valid ones succeed", async () => {
    await seedTradeState();
    expect(await AddCommand.execute(ctx([String(cardAId), String(cardBId), String(cardCId), '999999']))).toBeUndefined();

    const raw = await rawClient.get(stateKey());
    const state = JSON.parse(raw!);
    expect(state.offers.proposer[cardAId]).toBe(1);
    expect(state.offers.proposer[cardBId]).toBe(1);
    expect(state.offers.proposer[cardCId]).toBeUndefined();
  });

  test("removes multiple cards by ID in one command", async () => {
    expect(await RemoveCommand.execute(ctx([String(cardAId), String(cardBId)]))).toBeUndefined();

    const raw = await rawClient.get(stateKey());
    const state = JSON.parse(raw!);
    expect(state.offers.proposer[cardAId]).toBeUndefined();
    expect(state.offers.proposer[cardBId]).toBeUndefined();
  });

  test("a single non-numeric token still resolves by fuzzy name", async () => {
    expect(await AddCommand.execute(ctx(["Test AddRemove Card A"]))).toBeUndefined();
    const raw = await rawClient.get(stateKey());
    const state = JSON.parse(raw!);
    expect(state.offers.proposer[cardAId]).toBe(1);
  });
});
