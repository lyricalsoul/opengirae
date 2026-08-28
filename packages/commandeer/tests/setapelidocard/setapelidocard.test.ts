import { test, expect, describe, afterAll } from "bun:test";
import { TestFixtures, fakeCtx, mockTelegram, bootstrapCommandeerWorkers } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq, and } from "drizzle-orm";
import SetApelidoCardCommand from "../../commands/admin/setapelidocard";

mockTelegram();

describe("/setapelidocard", () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  test("adds the alias to the card and logs the action", async () => {
    await bootstrapCommandeerWorkers();

    // execute() is called directly, bypassing the isAdmin guard dispatch layer - see 03-commands.md's guard section.
    const admin = await fx.user({ displayName: "Test SetApelidoCard Admin", platform: 'telegram', platformId: `test-admin-${Date.now()}` });
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, admin.id)); });
    const card = await fx.card({ name: "Test SetApelidoCard Card" });

    const ctx = fakeCtx({ name: 'setapelidocard', authorId: admin.platformId, platform: 'telegram' });
    const cardDetails = await CardsDB.getCardWithDetails(card.id);

    await SetApelidoCardCommand.execute(ctx, { card: cardDetails!, alias: "  TSACAlias  " });

    const resolved = await CardsDB.getCardByAlias("tsacalias");
    expect(resolved?.id).toBe(card.id);

    const logged = await db.select().from(auditLogs).where(and(eq(auditLogs.actorUserId, admin.id), eq(auditLogs.action, 'card.aliasAdd')));
    expect(logged).toHaveLength(1);
    expect((logged[0]!.metadata as { cardId: number }).cardId).toBe(card.id);
  });

  test("adding the same alias again doesn't duplicate it", async () => {
    const admin = await fx.user({ displayName: "Test SetApelidoCard Admin Dupe", platform: 'telegram', platformId: `test-admin-dupe-${Date.now()}` });
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, admin.id)); });
    const card = await fx.card({ name: "Test SetApelidoCard Dupe Card" });

    const ctx = fakeCtx({ name: 'setapelidocard', authorId: admin.platformId, platform: 'telegram' });
    const cardDetails = await CardsDB.getCardWithDetails(card.id);

    await SetApelidoCardCommand.execute(ctx, { card: cardDetails!, alias: "tsacdupe" });
    await SetApelidoCardCommand.execute(ctx, { card: cardDetails!, alias: "tsacdupe" });

    const updated = await CardsDB.getCard(card.id);
    expect(updated!.aliases!.filter(a => a === "tsacdupe")).toHaveLength(1);
  });
});
