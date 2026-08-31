import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { userCards, subcategoryCompletionRewards } from "@girae/database/schemas/cards";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq, and } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import DarCommand from "../../commands/admin/dar";

mockTelegram();

describe("/dar grants coins, giros or cards to a target user", () => {
  const fx = new TestFixtures();
  const staffPlatformId = "test-dar-staff";
  const targetPlatformId = "test-dar-target";
  let staffId: number, targetId: number;
  let cardId: number;

  beforeAll(async () => {
    // /dar card emits cards:new via loaders/hooks.ts, same requirement as girarDrawFlow.test.ts.
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    staffId = (await fx.user({ displayName: "Test Dar Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    targetId = (await fx.user({ displayName: "Test Dar Target", platform: 'telegram', platformId: targetPlatformId })).id;

    const categoryId = (await fx.category({ name: `Test Dar Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: "Test Dar Subcategory" })).id;
    cardId = (await fx.card({ name: "Test Dar Card", subcategoryId })).id;

    fx.onCleanup(async () => {
      // granting all 10 copies completes the subcategory - clear the reward row before it's deleted.
      await db.delete(subcategoryCompletionRewards).where(eq(subcategoryCompletionRewards.subcategoryId, subcategoryId));
      await db.delete(userCards).where(and(eq(userCards.userId, targetId), eq(userCards.cardId, cardId)));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId));
    });
  });

  afterAll(() => fx.cleanup());

  function ctx(args: string[]) {
    return fakeCtx({ name: 'dar', authorId: staffPlatformId, args, platform: 'telegram' });
  }

  test("moedas: credits the target and logs the grant", async () => {
    await db.update(users).set({ coins: 0 }).where(eq(users.id, targetId));

    await DarCommand.giveCoins(ctx(['moedas', '2000', targetPlatformId]), { amount: 2000, target: targetPlatformId });

    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect(user!.coins).toBe(2000);

    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.actorUserId, staffId), eq(auditLogs.action, 'coins.grant')));
    expect(log?.metadata).toMatchObject({ targetUserId: targetId, amount: 2000 });
  });

  test("moedas: a non-positive amount is refused without touching the balance", async () => {
    await db.update(users).set({ coins: 500 }).where(eq(users.id, targetId));

    await DarCommand.giveCoins(ctx(['moedas', '0', targetPlatformId]), { amount: 0, target: targetPlatformId });

    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect(user!.coins).toBe(500);
  });

  test("giros: lowers usedDraws to grant extra giros", async () => {
    await db.update(users).set({ maxDraws: 24, usedDraws: 24 }).where(eq(users.id, targetId));

    await DarCommand.giveGiros(ctx(['giros', '5', targetPlatformId]), { amount: 5, target: targetPlatformId });

    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect(user!.usedDraws).toBe(19);
  });

  test("card: grants the requested count in one write", async () => {
    const card = await CardsDB.getCardWithDetails(cardId);
    await DarCommand.giveCard(ctx(['card', '10', String(cardId), targetPlatformId]), { amount: 10, card: card!, target: targetPlatformId });

    const [row] = await db.select().from(userCards).where(and(eq(userCards.userId, targetId), eq(userCards.cardId, cardId)));
    expect(row?.count).toBe(10);
  });

  test("an unknown target is refused without throwing", async () => {
    // no throw = pass; see 03-commands.md on why not `expect(promise).resolves...`
    await DarCommand.giveCoins(ctx(['moedas', '2000', '999999999']), { amount: 2000, target: '999999999' });
  });
});
