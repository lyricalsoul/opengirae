import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";
import PixCommand from "../../commands/main/pix";

mockTelegram();

describe("/pix transfers coins directly between users, without touching the treasury", () => {
  const fx = new TestFixtures();
  const senderPlatformId = "test-pix-sender";
  const recipientPlatformId = "test-pix-recipient";
  let senderId: number, recipientId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    senderId = (await fx.user({ displayName: "Test Pix Sender", platform: 'telegram', platformId: senderPlatformId })).id;
    recipientId = (await fx.user({ displayName: "Test Pix Recipient", platform: 'telegram', platformId: recipientPlatformId })).id;

    fx.onCleanup(async () => {
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, senderId));
    });
  });

  afterAll(() => fx.cleanup());

  async function setCoins(userId: number, amount: number) {
    await db.update(users).set({ coins: amount }).where(eq(users.id, userId));
  }

  async function coinsOf(userId: number): Promise<number> {
    const [row] = await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId));
    return row?.coins ?? 0;
  }

  function runCtx(args: string[], workflowID: string) {
    return fakeCtx({ name: 'pix', authorId: senderPlatformId, args, platform: 'telegram', workflowID });
  }

  async function runToConfirm(target: string, amountRaw: string) {
    const workflowID = `test-pix-${Bun.randomUUIDv7()}`;
    const ctx = runCtx([target, amountRaw], workflowID);
    const handle = await DBOS.startWorkflow(PixCommand, { workflowID }).execute(ctx, { target, amountRaw });
    await new Promise(r => setTimeout(r, 500));
    return { workflowID, handle };
  }

  test("sends coins to the recipient after confirming", async () => {
    await setCoins(senderId, 10000);
    await setCoins(recipientId, 0);

    const { workflowID, handle } = await runToConfirm(recipientPlatformId, "2000");
    await DBOS.send(workflowID, { value: true }, 'pix:confirm');
    await handle.getResult();

    expect(await coinsOf(senderId)).toBe(8000);
    expect(await coinsOf(recipientId)).toBe(2000);
  });

  test("cancelling leaves both balances untouched", async () => {
    await setCoins(senderId, 10000);
    const recipientBefore = await coinsOf(recipientId);

    const { workflowID, handle } = await runToConfirm(recipientPlatformId, "2000");
    await DBOS.send(workflowID, { value: false }, 'pix:confirm');
    await handle.getResult();

    expect(await coinsOf(senderId)).toBe(10000);
    expect(await coinsOf(recipientId)).toBe(recipientBefore);
  });

  test("* sends the sender's entire balance", async () => {
    await setCoins(senderId, 5000);
    const recipientBefore = await coinsOf(recipientId);

    const { workflowID, handle } = await runToConfirm(recipientPlatformId, "*");
    await DBOS.send(workflowID, { value: true }, 'pix:confirm');
    await handle.getResult();

    expect(await coinsOf(senderId)).toBe(0);
    expect(await coinsOf(recipientId)).toBe(recipientBefore + 5000);
  });

  test("donating to yourself resolves without throwing and moves nothing", async () => {
    await setCoins(senderId, 10000);
    const ctx = fakeCtx({ name: 'pix', authorId: senderPlatformId, args: [senderPlatformId, '2000'], platform: 'telegram' });
    await expect(PixCommand.execute(ctx, { target: senderPlatformId, amountRaw: '2000' })).resolves.toBeUndefined();
    expect(await coinsOf(senderId)).toBe(10000);
  });

  test("a negative amount is refused without prompting", async () => {
    await setCoins(senderId, 10000);
    const ctx = fakeCtx({ name: 'pix', authorId: senderPlatformId, args: [recipientPlatformId, '-500'], platform: 'telegram' });
    await expect(PixCommand.execute(ctx, { target: recipientPlatformId, amountRaw: '-500' })).resolves.toBeUndefined();
    expect(await coinsOf(senderId)).toBe(10000);
  });

  test("a decimal amount cancels without prompting", async () => {
    await setCoins(senderId, 10000);
    const ctx = fakeCtx({ name: 'pix', authorId: senderPlatformId, args: [recipientPlatformId, '1000.5'], platform: 'telegram' });
    await expect(PixCommand.execute(ctx, { target: recipientPlatformId, amountRaw: '1000.5' })).resolves.toBeUndefined();
    expect(await coinsOf(senderId)).toBe(10000);
  });

  test("more coins than the sender has is refused without prompting", async () => {
    await setCoins(senderId, 1500);
    const recipientBefore = await coinsOf(recipientId);
    const ctx = fakeCtx({ name: 'pix', authorId: senderPlatformId, args: [recipientPlatformId, '999999'], platform: 'telegram' });
    await expect(PixCommand.execute(ctx, { target: recipientPlatformId, amountRaw: '999999' })).resolves.toBeUndefined();
    expect(await coinsOf(senderId)).toBe(1500);
    expect(await coinsOf(recipientId)).toBe(recipientBefore);
  });

  test("below the 1000-coin minimum is refused without prompting", async () => {
    await setCoins(senderId, 10000);
    const ctx = fakeCtx({ name: 'pix', authorId: senderPlatformId, args: [recipientPlatformId, '500'], platform: 'telegram' });
    await expect(PixCommand.execute(ctx, { target: recipientPlatformId, amountRaw: '500' })).resolves.toBeUndefined();
    expect(await coinsOf(senderId)).toBe(10000);
  });

  test("a target who never used the bot is refused without prompting", async () => {
    await setCoins(senderId, 10000);
    const ctx = fakeCtx({ name: 'pix', authorId: senderPlatformId, args: ['999999999', '2000'], platform: 'telegram' });
    await expect(PixCommand.execute(ctx, { target: '999999999', amountRaw: '2000' })).resolves.toBeUndefined();
    expect(await coinsOf(senderId)).toBe(10000);
  });

  test("a TOCTOU race: the sender's balance drops below the amount between the confirm prompt and the click", async () => {
    await setCoins(senderId, 5000);
    const recipientBefore = await coinsOf(recipientId);

    const { workflowID, handle } = await runToConfirm(recipientPlatformId, "3000");

    await setCoins(senderId, 1000);

    await DBOS.send(workflowID, { value: true }, 'pix:confirm');
    await handle.getResult();

    expect(await coinsOf(senderId)).toBe(1000);
    expect(await coinsOf(recipientId)).toBe(recipientBefore);
  });
});
