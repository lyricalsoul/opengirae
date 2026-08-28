import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { userCards, trades } from "@girae/database/schemas/cards";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq, and, or } from "drizzle-orm";
import DoarClcCommand from "../../commands/cards/doarclc";

const { sentMessages } = mockTelegram();

describe("/doarclc donates every card a user owns in a collection as a one-sided trade", () => {
  const fx = new TestFixtures();
  const donorPlatformId = "test-doarclc-donor";
  const recipientPlatformId = "test-doarclc-recipient";
  let donorId: number, recipientId: number;
  let subcategoryId: number, otherSubcategoryId: number, emptySubcategoryId: number;
  let cardAId: number, cardBId: number, otherCardId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    donorId = (await fx.user({ displayName: "Test DoarClc Donor", platform: 'telegram', platformId: donorPlatformId })).id;
    recipientId = (await fx.user({ displayName: "Test DoarClc Recipient", platform: 'telegram', platformId: recipientPlatformId })).id;

    const categoryId = (await fx.category({ name: `Test DoarClc Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: `Test DoarClc Sub ${Date.now()}` })).id;
    otherSubcategoryId = (await fx.subcategory({ categoryId, name: `Test DoarClc Other Sub ${Date.now()}` })).id;
    // dedicated "owns nothing here" fixture, since otherSubcategoryId deliberately isn't empty
    emptySubcategoryId = (await fx.subcategory({ categoryId, name: `Test DoarClc Empty Sub ${Date.now()}` })).id;
    cardAId = (await fx.card({ name: `Test DoarClc Card A ${Date.now()}`, subcategoryId })).id;
    cardBId = (await fx.card({ name: `Test DoarClc Card B ${Date.now()}`, subcategoryId })).id;
    otherCardId = (await fx.card({ name: `Test DoarClc Other Card ${Date.now()}`, subcategoryId: otherSubcategoryId })).id;
    await fx.card({ name: `Test DoarClc Empty Sub Card ${Date.now()}`, subcategoryId: emptySubcategoryId });

    fx.onCleanup(async () => {
      await db.delete(trades).where(or(eq(trades.user1Id, donorId), eq(trades.user2Id, donorId), eq(trades.user1Id, recipientId), eq(trades.user2Id, recipientId)));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, donorId));
      await db.delete(userCards).where(or(eq(userCards.userId, donorId), eq(userCards.userId, recipientId)));
    });
  });

  afterAll(() => fx.cleanup());

  function runCtx(args: string[], workflowID: string) {
    return fakeCtx({ name: 'doarclc', authorId: donorPlatformId, args, platform: 'telegram', workflowID });
  }

  async function ownedCount(userId: number, cardId: number): Promise<number> {
    const row = await db.select().from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId))).then(r => r[0]);
    return row?.count ?? 0;
  }

  async function runToConfirm(subcategoryArg: string) {
    const workflowID = `test-doarclc-${Bun.randomUUIDv7()}`;
    const ctx = runCtx([recipientPlatformId, subcategoryArg], workflowID);
    const subcategory = await CardsDB.getSubcategory(parseInt(subcategoryArg, 10));
    const handle = await DBOS.startWorkflow(DoarClcCommand, { workflowID }).execute(ctx, { target: recipientPlatformId, subcategory: subcategory! });
    await new Promise(r => setTimeout(r, 500));
    return { workflowID, handle };
  }

  test("donates every owned card in the collection, ignoring cards from other collections", async () => {
    await fx.ownCard(donorId, cardAId, 2);
    await fx.ownCard(donorId, cardBId, 1);
    await fx.ownCard(donorId, otherCardId, 1);

    const startIndex = sentMessages.length;
    const { workflowID, handle } = await runToConfirm(String(subcategoryId));

    const confirmPrompt = sentMessages.slice(startIndex).find(m => typeof m.text === 'string' && m.text.includes('Doar toda'));
    expect(confirmPrompt).toBeDefined();
    expect(confirmPrompt!.text).toInclude('<strong>3</strong> carta(s)');

    await DBOS.send(workflowID, { value: true }, 'doarclc:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, cardAId)).toBe(0);
    expect(await ownedCount(donorId, cardBId)).toBe(0);
    expect(await ownedCount(recipientId, cardAId)).toBe(2);
    expect(await ownedCount(recipientId, cardBId)).toBe(1);
    expect(await ownedCount(donorId, otherCardId)).toBe(1);
    expect(await ownedCount(recipientId, otherCardId)).toBe(0);
  });

  test("cancelling leaves every card untouched", async () => {
    await fx.ownCard(donorId, cardAId, 1);
    const { workflowID, handle } = await runToConfirm(String(subcategoryId));
    await DBOS.send(workflowID, { value: false }, 'doarclc:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, cardAId)).toBe(1);
  });

  test("owning nothing in the collection resolves without throwing and prompts no confirmation", async () => {
    // unlike the self-donation case below, this reaches a real DB call before returning, so it needs a real workflow context
    const workflowID = `test-doarclc-empty-${Bun.randomUUIDv7()}`;
    const ctx = runCtx([recipientPlatformId, String(emptySubcategoryId)], workflowID);
    const subcategory = await CardsDB.getSubcategory(emptySubcategoryId);
    const handle = await DBOS.startWorkflow(DoarClcCommand, { workflowID }).execute(ctx, { target: recipientPlatformId, subcategory: subcategory! });
    await new Promise(r => setTimeout(r, 500));
    await expect(handle.getResult()).resolves.toBeUndefined();
  });

  test("donating to yourself resolves without throwing and moves nothing", async () => {
    const before = await ownedCount(donorId, cardAId);
    await fx.ownCard(donorId, cardAId, 1);
    const ctx = fakeCtx({ name: 'doarclc', authorId: donorPlatformId, args: [donorPlatformId, String(subcategoryId)], platform: 'telegram' });
    const subcategory = await CardsDB.getSubcategory(subcategoryId);
    await expect(DoarClcCommand.execute(ctx, { target: donorPlatformId, subcategory: subcategory! })).resolves.toBeUndefined();
    expect(await ownedCount(donorId, cardAId)).toBe(before + 1);
  });

  test("a TOCTOU race: the donor loses a card between the confirm prompt and the click", async () => {
    const recipientCardBBefore = await ownedCount(recipientId, cardBId);
    await fx.ownCard(donorId, cardAId, 1);
    await fx.ownCard(donorId, cardBId, 1);
    const donorCardBBefore = await ownedCount(donorId, cardBId);
    const { workflowID, handle } = await runToConfirm(String(subcategoryId));

    await db.delete(userCards).where(and(eq(userCards.userId, donorId), eq(userCards.cardId, cardAId)));

    await DBOS.send(workflowID, { value: true }, 'doarclc:confirm');
    await handle.getResult();

    // the whole donation rolls back - the still-owned card B must not have moved either
    expect(await ownedCount(donorId, cardBId)).toBe(donorCardBBefore);
    expect(await ownedCount(recipientId, cardBId)).toBe(recipientCardBBefore);
  });
});
