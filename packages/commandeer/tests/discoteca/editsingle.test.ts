import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, anyRarityId } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { DiscotecaDB } from "@girae/database/discoteca";
import { db } from "@girae/database/index";
import { discotecaEntries, discotecaEntrySubcategories } from "@girae/database/schemas/discoteca";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";

mockTelegram();

import EditSingleCommand from "../../commands/discoteca/editsingle";

describe("/editsingle", () => {
  const fx = new TestFixtures();
  let staffPlatformId: string;
  let staffId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    staffPlatformId = `test-editsingle-staff-${Date.now()}`;
    staffId = (await fx.user({ displayName: "Test Editsingle Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId)); });
  });

  afterAll(() => fx.cleanup());

  test("relinking a single to a different album via 🔄 Trocar álbum updates albumId", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Edit Single Artist" })).id;
    const rarityId = await anyRarityId();
    const oldAlbum = await DiscotecaDB.createEntry({
      name: "Test Old Album", artistId, appleMusicId: `test-editsingle-old-album-${Date.now()}`, type: 'album', rarityId,
    });
    const newAlbum = await DiscotecaDB.createEntry({
      name: "Test New Album", artistId, appleMusicId: `test-editsingle-new-album-${Date.now()}`, type: 'album', rarityId,
    });
    const entry = await DiscotecaDB.createEntry({
      name: "Test Editable Single", artistId, appleMusicId: `test-editsingle-${Date.now()}`, type: 'single', rarityId,
      albumId: oldAlbum!.id,
    });
    fx.onCleanup(async () => {
      await db.delete(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
      await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id));
    });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, oldAlbum!.id)); });
    fx.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, newAlbum!.id)); });

    const workflowID = `test-editsingle-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'editsingle', authorId: staffPlatformId, args: [String(entry!.id)], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(EditSingleCommand, { workflowID }).execute(runCtx, { entry: { id: entry!.id } } as any);

    await DBOS.send(workflowID, { value: { action: 'changeAlbum' } }, 'discoteca:confirm');
    await DBOS.send(workflowID, { value: String(newAlbum!.id) }, 'discoteca:album');
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const updated = await db.select().from(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)).then(r => r[0]);
    expect(updated?.albumId).toBe(newAlbum!.id);
  }, 15000);
});
