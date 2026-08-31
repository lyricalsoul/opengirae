import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { AuditDB } from "@girae/database/audit";
import { db } from "@girae/database/index";
import { userCards } from "@girae/database/schemas/cards";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq, and, inArray } from "drizzle-orm";
import DoacaoCancelarCommand from "../../commands/admin/doacaocancelar";

mockTelegram();

describe("/doacaocancelar reverts a donation and notifies the donor of what they got back", () => {
  const fx = new TestFixtures();
  const staffPlatformId = "test-doacaocancelar-staff";
  let staffId: number, donorId: number, recipientId: number;
  let cardId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    staffId = (await fx.user({ displayName: "Test Doacaocancelar Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    donorId = (await fx.user({ displayName: "Test Doacaocancelar Donor", platform: 'telegram', platformId: 'test-doacaocancelar-donor' })).id;
    recipientId = (await fx.user({ displayName: "Test Doacaocancelar Recipient" })).id;

    const categoryId = (await fx.category({ name: `Test Doacaocancelar Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: "Test Doacaocancelar Subcategory" })).id;
    cardId = (await fx.card({ name: "Test Doacaocancelar Card", subcategoryId })).id;

    fx.onCleanup(async () => {
      await db.delete(userCards).where(inArray(userCards.userId, [donorId, recipientId]));
      await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, [donorId, staffId]));
    });
  });

  afterAll(() => fx.cleanup());

  test("returns the donated card to the donor and DMs them without throwing", async () => {
    await fx.ownCard(recipientId, cardId, 1);
    const logRow = await AuditDB.log(donorId, "card.doar", { recipientUserId: recipientId, cards: [{ cardId, count: 1 }] });
    const auditLogId = logRow!.id;

    const workflowID = `test-doacaocancelar-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'doacaocancelar', authorId: staffPlatformId, args: [String(auditLogId)], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(DoacaoCancelarCommand, { workflowID }).execute(ctx, { auditLogId });

    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: true }, 'doacaocancelar:confirm');
    await handle.getResult();

    const donorRow = await db.select().from(userCards).where(and(eq(userCards.userId, donorId), eq(userCards.cardId, cardId))).then(r => r[0]);
    expect(donorRow?.count).toBe(1);

    const recipientRow = await db.select().from(userCards).where(and(eq(userCards.userId, recipientId), eq(userCards.cardId, cardId))).then(r => r[0]);
    expect(recipientRow).toBeUndefined();
  });
});
