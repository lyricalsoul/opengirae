import { test, expect, describe, afterAll } from "bun:test";
import { TestFixtures, fakeCtx, bootstrapCommandeerWorkers } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";
import MergeCardsCommand from "../../commands/admin/mergecards";

describe("/mergecards", () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  test("confirming the merge moves the source card's data onto the target and deletes the source", async () => {
    await bootstrapCommandeerWorkers();

    // execute() is called directly below, bypassing the isAdmin guard dispatch layer - see 03-commands.md's guard section.
    const admin = await fx.user({ displayName: "Test Mergecards Admin", platform: 'telegram', platformId: `test-admin-${Date.now()}` });
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, admin.id)); });
    const source = await fx.card({ name: "Test Mergecards Source" });
    const target = await fx.card({ name: "Test Mergecards Target" });

    const workflowID = `test-mergecards-${Date.now()}`;
    const ctx = fakeCtx({ name: 'mergecards', authorId: admin.platformId, platform: 'telegram', workflowID });

    const handle = await DBOS.startWorkflow(MergeCardsCommand, { workflowID }).execute(ctx, { source: await CardsDB.getCardWithDetails(source.id), target: await CardsDB.getCardWithDetails(target.id) });
    await DBOS.send(workflowID, { value: true }, 'mergecards:confirm');
    await handle.getResult();

    const sourceAfter = await CardsDB.getCardWithDetails(source.id);
    expect(sourceAfter).toBeUndefined();
  });
});
