import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, anyRarityId } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { DiscotecaDB } from "@girae/database/discoteca";
import { db } from "@girae/database/index";
import { discotecaEntries, discotecaEntrySubcategories } from "@girae/database/schemas/discoteca";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";

const { sentMessages } = mockTelegram();

import EditAlbumCommand from "../../commands/discoteca/editalbum";

describe("/editalbum", () => {
  const fx = new TestFixtures();
  let staffPlatformId: string;
  let staffId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    staffPlatformId = `test-editalbum-staff-${Date.now()}`;
    staffId = (await fx.user({ displayName: "Test Editalbum Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId)); });
  });

  afterAll(() => fx.cleanup());

  test("renaming an existing album via the ✏️ Nome button updates the stored name", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Edit Artist" })).id;
    const rarityId = await anyRarityId();
    const entry = await DiscotecaDB.createEntry({
      name: "Test Original Album Name", artistId, appleMusicId: `test-editalbum-${Date.now()}`, type: 'album', rarityId,
    });
    fx.onCleanup(async () => {
      await db.delete(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
      await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id));
    });

    const workflowID = `test-editalbum-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'editalbum', authorId: staffPlatformId, args: [String(entry!.id)], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(EditAlbumCommand, { workflowID }).execute(runCtx, { entry: { id: entry!.id } } as any);

    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: { action: 'editName' } }, 'discoteca:confirm');
    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: "Test Renamed Album Name" }, 'discoteca:name');
    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const updated = await db.select().from(discotecaEntries).where(eq(discotecaEntries.id, entry!.id)).then(r => r[0]);
    expect(updated?.name).toBe("Test Renamed Album Name");
  }, 15000);

  test("an album with artwork: the final 'atualizado' edit keeps the photo (editMessageCaption, not editMessageText)", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Edit Artist With Art" })).id;
    const rarityId = await anyRarityId();
    const entry = await DiscotecaDB.createEntry({
      name: "Test Album With Art", artistId, appleMusicId: `test-editalbum-art-${Date.now()}`, type: 'album', rarityId,
      artworkUrl: 'https://cdn.example.com/artwork.jpg',
    });
    fx.onCleanup(async () => {
      await db.delete(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
      await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id));
    });

    sentMessages.length = 0;
    const workflowID = `test-editalbum-art-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'editalbum', authorId: staffPlatformId, args: [String(entry!.id)], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(EditAlbumCommand, { workflowID }).execute(runCtx, { entry: { id: entry!.id } } as any);

    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: { action: 'confirm' }, messageId: 'fake-preview-msg-id' }, 'discoteca:confirm');
    await handle.getResult();

    const finalEdit = sentMessages[sentMessages.length - 1]!;
    expect(finalEdit.method).toBe('editMessageCaption');
    expect(finalEdit.caption).toContain('atualizado');
  }, 15000);

  test("sending an already-attached genre's name via ➕ Adicionar/remover gênero removes it, not duplicates it", async () => {
    const artistId = (await fx.discotecaArtist({ name: "Test Edit Genre Artist" })).id;
    const rarityId = await anyRarityId();
    const genreName = `Test Edit Genre ${Date.now()}`;
    const genreId = (await fx.discotecaGenre({ name: genreName })).id;
    const subcategoryId = (await fx.discotecaSubcategory({ genreId, isAlbum: true, name: `Álbuns de ${genreName}` })).id;
    const entry = await DiscotecaDB.createEntry({
      name: "Test Album With Genre", artistId, appleMusicId: `test-editalbum-genre-${Date.now()}`, type: 'album', rarityId,
    });
    await DiscotecaDB.setEntryGenres(entry!.id, [subcategoryId]);
    fx.onCleanup(async () => {
      await db.delete(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
      await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entry!.id));
    });

    const workflowID = `test-editalbum-genre-${Bun.randomUUIDv7()}`;
    const runCtx = fakeCtx({ name: 'editalbum', authorId: staffPlatformId, args: [String(entry!.id)], platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(EditAlbumCommand, { workflowID }).execute(runCtx, { entry: { id: entry!.id } } as any);

    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: { action: 'addGenre' } }, 'discoteca:confirm');
    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: genreName }, 'discoteca:addGenre');
    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: { action: 'confirm' } }, 'discoteca:confirm');
    await handle.getResult();

    const remaining = await db.select().from(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entry!.id));
    expect(remaining).toHaveLength(0);
  }, 15000);
});
