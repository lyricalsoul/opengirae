import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, awaitRecv } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { userCards, trades } from "@girae/database/schemas/cards";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq, and, or } from "drizzle-orm";
import DoarCommand from "../../commands/cards/doar";

const { sentMessages } = mockTelegram();

describe("/doar (and its alias /micar) donate cards as a one-sided trade", () => {
  const fx = new TestFixtures();
  const donorPlatformId = "test-doar-donor";
  const recipientPlatformId = "test-doar-recipient";
  let donorId: number, recipientId: number;
  let cardAId: number, cardBId: number, cardCId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    donorId = (await fx.user({ displayName: "Test Doar Donor", platform: 'telegram', platformId: donorPlatformId })).id;
    recipientId = (await fx.user({ displayName: "Test Doar Recipient", platform: 'telegram', platformId: recipientPlatformId })).id;

    const categoryId = (await fx.category({ name: `Test Doar Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test Doar Sub ${Date.now()}` })).id;
    cardAId = (await fx.card({ name: `Test Doar Card A ${Date.now()}`, subcategoryId })).id;
    cardBId = (await fx.card({ name: `Test Doar Card B ${Date.now()}`, subcategoryId })).id;
    cardCId = (await fx.card({ name: `Test Doar Card C ${Date.now()}`, subcategoryId })).id;

    fx.onCleanup(async () => {
      await db.delete(trades).where(or(eq(trades.user1Id, donorId), eq(trades.user2Id, donorId), eq(trades.user1Id, recipientId), eq(trades.user2Id, recipientId)));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, donorId));
      await db.delete(userCards).where(or(eq(userCards.userId, donorId), eq(userCards.userId, recipientId)));
    });
  });

  afterAll(() => fx.cleanup());

  function runCtx(args: string[], workflowID: string) {
    return fakeCtx({ name: 'doar', authorId: donorPlatformId, args, platform: 'telegram', workflowID });
  }

  async function ownedCount(userId: number, cardId: number): Promise<number> {
    const row = await db.select().from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId))).then(r => r[0]);
    return row?.count ?? 0;
  }

  async function runToConfirm(args: string[], targetPlatformId = recipientPlatformId) {
    const workflowID = `test-doar-${Bun.randomUUIDv7()}`;
    const ctx = runCtx(args, workflowID);
    const handle = await DBOS.startWorkflow(DoarCommand, { workflowID }).execute(ctx, { target: targetPlatformId, cardsRaw: args.join(' ') });
    await awaitRecv(workflowID)
    return { workflowID, handle };
  }

  test("donates a single card by ID", async () => {
    await fx.ownCard(donorId, cardAId, 1);
    const { workflowID, handle } = await runToConfirm([String(cardAId)]);
    await DBOS.send(workflowID, { value: true }, 'doar:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, cardAId)).toBe(0);
    expect(await ownedCount(recipientId, cardAId)).toBe(1);
  });

  test("donates a single card by fuzzy name", async () => {
    await fx.ownCard(donorId, cardBId, 1);
    const { workflowID, handle } = await runToConfirm([`Test Doar Card B`]);
    await DBOS.send(workflowID, { value: true }, 'doar:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, cardBId)).toBe(0);
    expect(await ownedCount(recipientId, cardBId)).toBe(1);
  });

  test("donates multiple cards by ID in one command, skipping ones not owned", async () => {
    await fx.ownCard(donorId, cardAId, 1);
    const { workflowID, handle } = await runToConfirm([String(cardAId), String(cardCId), '999999']);
    await DBOS.send(workflowID, { value: true }, 'doar:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, cardAId)).toBe(0);
    expect(await ownedCount(recipientId, cardAId)).toBe(2);
    expect(await ownedCount(recipientId, cardCId)).toBe(0);
  });

  test("a repeated ID donates that many copies, and the confirmation prompt totals the quantity (not the distinct ID count)", async () => {
    await fx.ownCard(donorId, cardAId, 2);
    const recipientCountBefore = await ownedCount(recipientId, cardAId);
    const startIndex = sentMessages.length;
    const { workflowID, handle } = await runToConfirm([String(cardAId), String(cardAId)]);

    const confirmPrompt = sentMessages.slice(startIndex).find(m => typeof m.text === 'string' && m.text.includes('Doar'));
    expect(confirmPrompt).toBeDefined();
    expect(confirmPrompt!.text).toInclude('Doar <strong>2</strong> carta(s)');

    await DBOS.send(workflowID, { value: true }, 'doar:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, cardAId)).toBe(0);
    expect(await ownedCount(recipientId, cardAId)).toBe(recipientCountBefore + 2);
  });

  test("a repeated ID exceeding owned quantity is skipped, other cards still go through", async () => {
    await fx.ownCard(donorId, cardBId, 1);
    await fx.ownCard(donorId, cardCId, 1);
    const donorBCountBefore = await ownedCount(donorId, cardBId);
    const recipientCCountBefore = await ownedCount(recipientId, cardCId);
    const { workflowID, handle } = await runToConfirm([String(cardBId), String(cardBId), String(cardCId)]);
    await DBOS.send(workflowID, { value: true }, 'doar:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, cardBId)).toBe(donorBCountBefore);
    expect(await ownedCount(donorId, cardCId)).toBe(0);
    expect(await ownedCount(recipientId, cardCId)).toBe(recipientCCountBefore + 1);
  });

  test("* donates the donor's entire collection, full counts included", async () => {
    const bulkDonorPlatformId = "test-doar-bulk-donor";
    const bulkDonorId = (await fx.user({ displayName: "Test Doar Bulk Donor", platform: 'telegram', platformId: bulkDonorPlatformId })).id;
    fx.onCleanup(async () => {
      await db.delete(trades).where(or(eq(trades.user1Id, bulkDonorId), eq(trades.user2Id, bulkDonorId)));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, bulkDonorId));
      await db.delete(userCards).where(eq(userCards.userId, bulkDonorId));
    });
    await fx.ownCard(bulkDonorId, cardAId, 4);
    await fx.ownCard(bulkDonorId, cardBId, 2);

    const workflowID = `test-doar-star-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'doar', authorId: bulkDonorPlatformId, args: ['*'], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(DoarCommand, { workflowID }).execute(ctx, { target: recipientPlatformId, cardsRaw: '*' });
    await DBOS.send(workflowID, { value: true }, 'doar:confirm');
    await handle.getResult();

    expect(await ownedCount(bulkDonorId, cardAId)).toBe(0);
    expect(await ownedCount(bulkDonorId, cardBId)).toBe(0);
    expect(await ownedCount(recipientId, cardAId)).toBeGreaterThanOrEqual(4);
    expect(await ownedCount(recipientId, cardBId)).toBeGreaterThanOrEqual(2);
  });

  test("donating to yourself resolves without throwing and moves nothing", async () => {
    await fx.ownCard(donorId, cardAId, 1);
    const ctx = fakeCtx({ name: 'doar', authorId: donorPlatformId, args: [String(cardAId)], platform: 'telegram' });
    await DoarCommand.execute(ctx, { target: donorPlatformId, cardsRaw: String(cardAId) }); // no throw = pass
    expect(await ownedCount(donorId, cardAId)).toBe(1);
  });

  test("has no recipient card cap: a recipient with over 1500 cards still receives the donation", async () => {
    // the cap was removed deliberately (eabd5da); this pins that so it can't silently come back half-wired
    const bigRecipientPlatformId = "test-doar-big-recipient";
    const bigRecipientId = (await fx.user({ displayName: "Test Doar Big Recipient", platform: 'telegram', platformId: bigRecipientPlatformId })).id;
    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, bigRecipientId)); });
    // a direct insert, not fx.ownCard() in a loop - 1501 round trips through addUserCard would be needlessly slow here.
    await db.insert(userCards).values({ userId: bigRecipientId, cardId: cardAId, count: 1501 });

    await fx.ownCard(donorId, cardBId, 1);
    const { workflowID, handle } = await runToConfirm([String(cardBId)], bigRecipientPlatformId);
    await DBOS.send(workflowID, { value: true }, 'doar:confirm');
    await handle.getResult();

    expect(await ownedCount(bigRecipientId, cardBId)).toBe(1);
  }, 10000);

  test("a TOCTOU race: donor loses the card between the confirm prompt and the click", async () => {
    await fx.ownCard(donorId, cardAId, 1);
    const recipientCountBefore = await ownedCount(recipientId, cardAId);
    const { workflowID, handle } = await runToConfirm([String(cardAId)]);

    await db.delete(userCards).where(and(eq(userCards.userId, donorId), eq(userCards.cardId, cardAId)));

    await DBOS.send(workflowID, { value: true }, 'doar:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, cardAId)).toBe(0);
    expect(await ownedCount(recipientId, cardAId)).toBe(recipientCountBefore);
  });
});
