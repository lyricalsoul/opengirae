import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { trades } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import HtrocaCommand from "../../commands/admin/htroca";

mockTelegram();

describe("/htroca shows a user's trade history stats", () => {
  const fx = new TestFixtures();
  let staffPlatformId: string;
  let activeTargetId: number, activeTargetPlatformId: string;
  let quietTargetId: number, quietTargetPlatformId: string;
  const insertedTradeIds: number[] = [];

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    staffPlatformId = 'test-htroca-staff';
    await fx.user({ displayName: "Test Htroca Staff", platform: 'telegram', platformId: staffPlatformId });

    activeTargetPlatformId = 'test-htroca-active-target';
    activeTargetId = (await fx.user({ displayName: "Test Htroca Active", platform: 'telegram', platformId: activeTargetPlatformId })).id;

    quietTargetPlatformId = 'test-htroca-quiet-target';
    quietTargetId = (await fx.user({ displayName: "Test Htroca Quiet", platform: 'telegram', platformId: quietTargetPlatformId })).id;

    const partnerId = (await fx.user({ displayName: "Test Htroca Partner" })).id;
    const [row] = await db.insert(trades).values({ user1Id: activeTargetId, user2Id: partnerId, cardsUser1: [], cardsUser2: [] }).returning();
    insertedTradeIds.push(row!.id);
  });

  afterAll(async () => {
    for (const id of insertedTradeIds) await db.delete(trades).where(eq(trades.id, id));
    await fx.cleanup();
  });

  function ctx(targetPlatformId: string) {
    return fakeCtx({ name: 'htroca', authorId: staffPlatformId, args: [`@${targetPlatformId}`], platform: 'telegram' });
  }

  test("a user with no trades gets the 'nenhuma troca' reply (resolves without throwing)", async () => {
    await HtrocaCommand.execute(ctx(quietTargetPlatformId), { target: quietTargetPlatformId });
  });

  test("a user with a trade resolves without throwing and the underlying stats are correct", async () => {
    await HtrocaCommand.execute(ctx(activeTargetPlatformId), { target: activeTargetPlatformId });
    // per docs/agent/03-commands.md: assert underlying DB state, don't race the reply queue
    const stats = await import("@girae/database/cards").then(m => m.CardsDB.getTradeStats(activeTargetId));
    expect(stats.initiated).toBe(1);
  });
});
