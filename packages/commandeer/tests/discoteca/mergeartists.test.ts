import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, anyRarityId } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { DiscotecaDB } from "@girae/database/discoteca";
import { db } from "@girae/database/index";
import { discotecaArtists } from "@girae/database/schemas/discoteca";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";
import MergeArtistsCommand from "../../commands/admin/mergeartists";

mockTelegram();

describe("/mergeartists", () => {
  const fx = new TestFixtures();
  let staffPlatformId: string;
  let staffId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    staffPlatformId = `test-mergeartists-staff-${Date.now()}`;
    staffId = (await fx.user({ displayName: "Test Mergeartists Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId)); });
  });

  afterAll(() => fx.cleanup());

  test("declining leaves both artists intact", async () => {
    const source = await fx.discotecaArtist({ name: "Test Mergeartists Decline Source" });
    const target = await fx.discotecaArtist({ name: "Test Mergeartists Decline Target" });

    const workflowID = `test-mergeartists-decline-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'mergeartists', authorId: staffPlatformId, args: [String(source.id), String(target.id)], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(MergeArtistsCommand, { workflowID }).execute(runCtx, {
      source: { id: source.id, name: "Test Mergeartists Decline Source" },
      target: { id: target.id, name: "Test Mergeartists Decline Target" },
    } as any);

    await DBOS.send(workflowID, { value: false }, 'mergeartists:confirm');
    await handle.getResult();

    const sourceRow = await DiscotecaDB.getArtist(source.id);
    expect(sourceRow).toBeDefined();
  });

  test("confirming merges the source into the target", async () => {
    const source = await fx.discotecaArtist({ name: "Test Mergeartists Confirm Source" });
    const target = await fx.discotecaArtist({ name: "Test Mergeartists Confirm Target" });
    const entry = await fx.discotecaEntry({ name: "Test Mergeartists Entry", artistId: source.id, type: 'single', rarityId: await anyRarityId() });

    const workflowID = `test-mergeartists-confirm-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'mergeartists', authorId: staffPlatformId, args: [String(source.id), String(target.id)], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(MergeArtistsCommand, { workflowID }).execute(runCtx, {
      source: { id: source.id, name: "Test Mergeartists Confirm Source" },
      target: { id: target.id, name: "Test Mergeartists Confirm Target" },
    } as any);

    await DBOS.send(workflowID, { value: true }, 'mergeartists:confirm');
    await handle.getResult();

    const sourceRow = await DiscotecaDB.getArtist(source.id);
    expect(sourceRow).toBeUndefined();

    const movedEntry = await DiscotecaDB.getEntry(entry.id);
    expect(movedEntry?.artistId).toBe(target.id);
  });
});
