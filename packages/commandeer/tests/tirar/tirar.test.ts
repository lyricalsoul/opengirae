import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { userCards, subcategoryCompletionRewards } from "@girae/database/schemas/cards";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq, and } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import { EconomyDB } from "@girae/database/economy";
import TirarCommand from "../../commands/admin/tirar";

mockTelegram();

describe("/tirar confiscates coins, giros or cards from a target user", () => {
  const fx = new TestFixtures();
  const staffPlatformId = "test-tirar-staff";
  const targetPlatformId = "test-tirar-target";
  let staffId: number, targetId: number;
  let cardId: number;

  beforeAll(async () => {
    staffId = (await fx.user({ displayName: "Test Tirar Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    targetId = (await fx.user({ displayName: "Test Tirar Target", platform: 'telegram', platformId: targetPlatformId })).id;

    const categoryId = (await fx.category({ name: `Test Tirar Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: "Test Tirar Subcategory" })).id;
    cardId = (await fx.card({ name: "Test Tirar Card", subcategoryId })).id;

    fx.onCleanup(async () => {
      // granting 10 copies completes the subcategory - clear the reward row before it's deleted.
      await db.delete(subcategoryCompletionRewards).where(eq(subcategoryCompletionRewards.subcategoryId, subcategoryId));
      await db.delete(userCards).where(and(eq(userCards.userId, targetId), eq(userCards.cardId, cardId)));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId));
    });
  });

  afterAll(() => fx.cleanup());

  function ctx(args: string[]) {
    return fakeCtx({ name: 'tirar', authorId: staffPlatformId, args, platform: 'telegram' });
  }

  test("moedas: debits the target and logs the confiscation", async () => {
    await db.update(users).set({ coins: 2000, treasuryContributed: 0 }).where(eq(users.id, targetId));

    await TirarCommand.takeCoins(ctx(['moedas', '500', targetPlatformId]), { amount: 500, target: targetPlatformId });

    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect(user!.coins).toBe(1500);
    expect(user!.treasuryContributed).toBe(0); // confiscation, not a purchase

    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.actorUserId, staffId), eq(auditLogs.action, 'coins.confiscate')));
    expect(log?.metadata).toMatchObject({ targetUserId: targetId, amount: 500 });
  });

  test("moedas: refuses to take more than the target has", async () => {
    await db.update(users).set({ coins: 100 }).where(eq(users.id, targetId));

    await TirarCommand.takeCoins(ctx(['moedas', '500', targetPlatformId]), { amount: 500, target: targetPlatformId });

    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect(user!.coins).toBe(100);
  });

  test("giros: raises usedDraws, clamped so remaining giros never goes negative", async () => {
    await db.update(users).set({ maxDraws: 24, usedDraws: 20 }).where(eq(users.id, targetId));

    await TirarCommand.takeGiros(ctx(['giros', '100', targetPlatformId]), { amount: 100, target: targetPlatformId });

    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    expect(user!.usedDraws).toBe(24);
  });

  test("card: removes the requested count", async () => {
    const incomeInflationRate = await EconomyDB.getIncomeInflationRate();
    await CardsDB.grantUserCards(targetId, cardId, 10, incomeInflationRate);
    const card = await CardsDB.getCardWithDetails(cardId);

    await TirarCommand.takeCard(ctx(['card', '4', String(cardId), targetPlatformId]), { amount: 4, card: card!, target: targetPlatformId });

    const [row] = await db.select().from(userCards).where(and(eq(userCards.userId, targetId), eq(userCards.cardId, cardId)));
    expect(row?.count).toBe(6);
  });

  test("card: refuses to take more copies than the target owns", async () => {
    const card = await CardsDB.getCardWithDetails(cardId);

    await TirarCommand.takeCard(ctx(['card', '999', String(cardId), targetPlatformId]), { amount: 999, card: card!, target: targetPlatformId });

    const [row] = await db.select().from(userCards).where(and(eq(userCards.userId, targetId), eq(userCards.cardId, cardId)));
    expect(row?.count).toBe(6); // untouched
  });
});
