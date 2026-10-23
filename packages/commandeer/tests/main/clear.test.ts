import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { cardCustomizationSubmissions } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import ClearCommand from "../../commands/main/clear";

const { sentMessages } = mockTelegram();

describe("/clear cativeiro upload cancellation", () => {
  const fx = new TestFixtures();
  let authorId: string;
  let userId: number;
  let rarityId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    authorId = `test-clear-cativeiro-${Date.now()}`;
    userId = (await fx.user({ displayName: "Test Clear Cativeiro", platform: 'telegram', platformId: authorId })).id;
    rarityId = (await fx.rarity({ name: `Test Clear Rarity ${Date.now()}` })).id;
  });

  afterAll(() => fx.cleanup());

  async function createPendingSubmission() {
    const cardId = (await fx.card({ name: `Test Clear Card ${Bun.randomUUIDv7()}`, rarityId })).id;
    fx.onCleanup(async () => { await db.delete(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.cardId, cardId)); });
    const result = await CardsDB.createCativeiroSubmission(userId, cardId, 'https://example.com/fake.jpg', 'photo', {
      platform: 'telegram', platformId: authorId, name: 'Test Clear Cativeiro', chatId: 'chat-1',
    });
    return result.submission!;
  }

  test("no pending anything: says so", async () => {
    const workflowID = `test-clear-none-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'clear', authorId: `test-clear-empty-${Date.now()}`, platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(ClearCommand, { workflowID }).execute(ctx);
    await handle.getResult();

    const last = sentMessages[sentMessages.length - 1]!;
    expect(last.text).toContain('Você não tem nenhum giro, troca ou upload pendente');
  });

  test("declining the confirmation keeps the submission pending", async () => {
    const submission = await createPendingSubmission();

    const workflowID = `test-clear-decline-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'clear', authorId, platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(ClearCommand, { workflowID }).execute(ctx);

    await DBOS.send(workflowID, { value: false }, 'clear:cativeiroCancel');
    await handle.getResult();

    const row = await db.select().from(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.id, submission.id)).then(r => r[0]);
    expect(row?.status).toBe('pending');

    // left pending on purpose to prove the decline path - close it out so it doesn't leak into later tests
    await CardsDB.rejectCativeiroSubmission(submission.id);
  });

  test("confirming the cancellation marks the submission cancelled and notifies the review channel", async () => {
    const submission = await createPendingSubmission();

    const workflowID = `test-clear-confirm-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'clear', authorId, platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(ClearCommand, { workflowID }).execute(ctx);

    await DBOS.send(workflowID, { value: true }, 'clear:cativeiroCancel');
    await handle.getResult();

    const row = await db.select().from(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.id, submission.id)).then(r => r[0]);
    expect(row?.status).toBe('cancelled');

    const cancelNotice = sentMessages.find(m => (typeof m.text === 'string' && m.text.includes('CANCELADO_PELO_USUÁRIO')) || (typeof m.caption === 'string' && m.caption.includes('CANCELADO_PELO_USUÁRIO')));
    expect(cancelNotice).toBeDefined();
  });
});
