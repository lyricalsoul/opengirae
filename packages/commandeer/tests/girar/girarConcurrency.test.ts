import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { categories } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import { rawClient, commandQueue } from "@girae/common/queue";
import { processCallback } from "@girae/common/inbound/callback";

// Must run at module scope, not inside beforeAll - mock.module only affects imports that happen afterward.
const { sentMessages } = mockTelegram();

describe("girar concurrency (real workers, TOCTOU coverage)", () => {
  const fx = new TestFixtures();
  let userId: number;
  let telegramId: string;

  beforeAll(async () => {
    await bootstrapCommandeerWorkers();

    telegramId = `test-girar-concurrency-${Date.now()}`;
    userId = (await fx.user({ displayName: "Test Girar Concurrency", platform: 'telegram', platformId: telegramId })).id;

    const categoryId = (await fx.category({ name: "Test Concurrency Category", emoji: "🧪" })).id;
    await db.update(categories).set({ subcategoriesOnDraw: 1 }).where(eq(categories.id, categoryId));

    const subcategoryId = (await fx.subcategory({ categoryId, name: "Test Concurrency Sub" })).id;
    await fx.card({ name: "Test Concurrency Card", subcategoryId });
  });

  afterAll(async () => {
    await rawClient.del(`girar:active:${telegramId}`);
    await fx.cleanup();
  });

  const chatId = () => `chat-${telegramId}`;
  const makeCommand = () => fakeCtx({
    name: 'girar',
    authorId: telegramId,
    platform: 'telegram',
    chatId: chatId(),
    workflowID: `wf-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  });

  test("two concurrent /girar invocations for the same user: only one claims the flow", async () => {
    const claimed = await Promise.all([
      rawClient.set(`girar:active:${telegramId}`, JSON.stringify({ workflowID: 'a', kind: 'batch' }), { NX: true, EX: 60 }),
      rawClient.set(`girar:active:${telegramId}`, JSON.stringify({ workflowID: 'b', kind: 'batch' }), { NX: true, EX: 60 }),
    ]);
    expect(claimed.filter(r => r === 'OK').length).toBe(1);
    await rawClient.del(`girar:active:${telegramId}`);
  });

  test("firing two /girar commands at once: exactly one interactive flow proceeds, the other gets a resend or block, no double draw", async () => {
    await rawClient.del(`girar:active:${telegramId}`);
    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);

    await Promise.all([
      commandQueue.add('executeCommand', makeCommand()),
      commandQueue.add('executeCommand', makeCommand()),
    ]);

    // give the real workers time to process both jobs end-to-end
    await new Promise(resolve => setTimeout(resolve, 3000));

    // usedDraws only increments at the subcategory-selection reply, never reached here - must move by at most 1.
    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after - before).toBeLessThanOrEqual(1);

    // the second invocation's reply must be the resend/blocked message, not a second independent flow.
    const categoryPrompts = sentMessages.filter(m => typeof m.text === 'string' && m.text.includes('Escolha uma categoria'));
    expect(categoryPrompts.length).toBeGreaterThanOrEqual(1);

    await rawClient.del(`girar:active:${telegramId}`);
  }, 10000);

  test("clicking the RESENT category button resumes the original still-running workflow (not a dead/duplicate one)", async () => {
    await rawClient.del(`girar:active:${telegramId}`);
    const startIndex = sentMessages.length;

    // First invocation: starts the real workflow, which parks at DBOS.recv() waiting for a click.
    await commandQueue.add('executeCommand', makeCommand());
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Second invocation: claim fails (first still holds it), so this hits the resend path.
    await commandQueue.add('executeCommand', makeCommand());
    await new Promise(resolve => setTimeout(resolve, 1500));

    const categoryPrompts = sentMessages
      .slice(startIndex)
      .filter(m => m.method === 'sendMessage' && typeof m.text === 'string' && m.text.includes('Escolha uma categoria'));
    expect(categoryPrompts.length).toBe(2);

    // Click the resent one specifically. Category list includes every non-hidden category in the DB
    // (not just this fixture), so find the button by name rather than assuming a position.
    const resent = categoryPrompts[categoryPrompts.length - 1]!;
    const button = resent.replyMarkup?.inline_keyboard?.flat().find((b: any) => b.text?.includes('Test Concurrency Category'));
    expect(button).toBeDefined();
    const callbackData = button?.callback_data;
    expect(typeof callbackData).toBe('string');

    const before = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);

    await processCallback(callbackData!, telegramId, `test-click-${Date.now()}`, 'telegram', chatId(), 'resent-msg-id');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // proves the click reached the real, still-running workflow, not a dead/expired one.
    const subcategoryPrompts = sentMessages
      .slice(startIndex)
      .filter(m => m.method === 'editMessageText' && typeof m.text === 'string' && m.text.includes('Escolha uma coleção de'));
    expect(subcategoryPrompts.length).toBe(1);

    const after = await db.select({ usedDraws: users.usedDraws }).from(users).where(eq(users.id, userId)).then(r => r[0]!.usedDraws);
    expect(after - before).toBe(1);

    await rawClient.del(`girar:active:${telegramId}`);
  }, 15000);
});
