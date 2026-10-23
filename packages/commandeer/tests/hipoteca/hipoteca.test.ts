import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { CardsDB } from "@girae/database/cards";
import { UsersDB } from "@girae/database/users";
import { db } from "@girae/database/index";
import { rarities } from "@girae/database/schemas/cards";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";
import HipotecaCommand from "../../commands/admin/hipoteca";

mockTelegram();

describe("/hipoteca toggles a hold on a user's legendary cards", () => {
  const fx = new TestFixtures();
  let staffId: number, staffPlatformId: string;
  let targetId: number, targetPlatformId: string;
  let legendaryCardId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    staffPlatformId = 'test-hipoteca-staff';
    targetPlatformId = 'test-hipoteca-target';
    staffId = (await fx.user({ displayName: "Test Hipoteca Staff Cmd", platform: 'telegram', platformId: staffPlatformId })).id;
    targetId = (await fx.user({ displayName: "Test Hipoteca Target Cmd", platform: 'telegram', platformId: targetPlatformId })).id;

    // "Lendário" is real catalog data already seeded in the shared dev DB, not something the fixture can create.
    const legendaryRarityId = await db.select({ id: rarities.id }).from(rarities).where(eq(rarities.name, "Lendário")).then(r => r[0]!.id);
    const categoryId = (await fx.category({ name: `Test Hipoteca Cmd Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test Hipoteca Cmd Sub ${Date.now()}` })).id;
    legendaryCardId = (await fx.card({ name: "Test Hipoteca Cmd Legendary", rarityId: legendaryRarityId, subcategoryId })).id;
    await fx.ownCard(targetId, legendaryCardId, 2);

    // apply/liftHipoteca write AuditDB.log rows - must clear those before staff cleanup deletes the user, or the FK blocks it.
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId)); });
  });

  afterAll(() => fx.cleanup());

  test("with no active session, applying moves the target's legendary cards out and zeroes their luckModifier", async () => {
    const workflowID = `test-hipoteca-apply-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'hipoteca', authorId: staffPlatformId, args: [`@${targetPlatformId}`], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(HipotecaCommand, { workflowID }).execute(runCtx, { target: targetPlatformId });

    // give the workflow a moment to reach DBOS.recv and register the confirm listener
    await DBOS.send(workflowID, { value: true }, 'hipoteca:confirm');
    await handle.getResult();

    const session = await CardsDB.getActiveHipotecaSession(targetId);
    expect(session?.holdings.length).toBe(1);

    const targetUser = await UsersDB.getUserById(targetId);
    expect(targetUser?.luckModifier).toBe(0);
  });

  test("with an active session, a second call returns the cards and restores luckModifier", async () => {
    const workflowID = `test-hipoteca-return-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'hipoteca', authorId: staffPlatformId, args: [`@${targetPlatformId}`], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(HipotecaCommand, { workflowID }).execute(runCtx, { target: targetPlatformId });

    await DBOS.send(workflowID, { value: true }, 'hipoteca:confirm');
    await handle.getResult();

    expect(await CardsDB.getActiveHipotecaSession(targetId)).toBeUndefined();
    const targetUser = await UsersDB.getUserById(targetId);
    expect(targetUser?.luckModifier).toBe(100);
  });

  test("a target with no legendary cards gets the early reply and no session is created", async () => {
    const bareTargetPlatformId = 'test-hipoteca-bare-target';
    const bareTargetId = (await fx.user({ displayName: "Test Hipoteca Bare Target", platform: 'telegram', platformId: bareTargetPlatformId })).id;

    const workflowID = `test-hipoteca-bare-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'hipoteca', authorId: staffPlatformId, args: [`@${bareTargetPlatformId}`], platform: 'telegram', workflowID });
    await DBOS.startWorkflow(HipotecaCommand, { workflowID }).execute(runCtx, { target: bareTargetPlatformId }).then(h => h.getResult());

    expect(await CardsDB.getActiveHipotecaSession(bareTargetId)).toBeUndefined();
  });
});
