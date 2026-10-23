import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, anyRarityId, lastReply } from "@girae/tests";
import { DiscotecaDB } from "@girae/database/discoteca";
import { db } from "@girae/database/index";
import { discotecaEntries, discotecaEntrySubcategories } from "@girae/database/schemas/discoteca";
import { eq } from "drizzle-orm";
import GenerosCommand from "../../commands/discoteca/generos";

const { sentMessages } = mockTelegram();

describe("/generos", () => {
  const fx = new TestFixtures();
  let userPlatformId: string;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();
    userPlatformId = `test-generos-user-${Date.now()}`;
    await fx.user({ displayName: "Test Generos User", platform: 'telegram', platformId: userPlatformId });
  });

  afterAll(() => fx.cleanup());

  test("no argument: lists genres", async () => {
    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'generos', authorId: userPlatformId, args: [], platform: 'telegram' });
    await GenerosCommand.execute(ctx, { genre: undefined });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain('Gêneros da discoteca');
    expect(text).toContain('Álbuns de Pop');
  });

  test("with an argument: lists the entries mapped to that genre", async () => {
    const subcategoryName = `Test Generos Entries ${Date.now()}`;
    const subcategoryId = (await fx.discotecaSubcategory({ name: subcategoryName, isAlbum: true, emoji: '💽' })).id;
    const artistId = (await fx.discotecaArtist()).id;
    const entryName = `Test Generos Entry ${Date.now()}`;
    const entryRow = await DiscotecaDB.createEntry({
      name: entryName, artistId, appleMusicId: `test-generos-entry-${Date.now()}`, type: 'album',
      rarityId: await anyRarityId(),
    });
    const entryId = entryRow!.id;
    await DiscotecaDB.setEntryGenres(entryId, [subcategoryId]);
    fx.onCleanup(async () => {
      await db.delete(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entryId));
      await db.delete(discotecaEntries).where(eq(discotecaEntries.id, entryId));
    });
    const subcategory = await DiscotecaDB.getSubcategory(subcategoryId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'generos', authorId: userPlatformId, args: [subcategoryName], platform: 'telegram' });
    await GenerosCommand.execute(ctx, { genre: subcategory! });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain(entryName);
    expect(text).toContain('💽');
  });

  test("with an argument matching an empty genre: says there's nothing there yet", async () => {
    const subcategoryName = `Test Generos Empty ${Date.now()}`;
    const subcategoryId = (await fx.discotecaSubcategory({ name: subcategoryName, isAlbum: false, emoji: '🎵' })).id;
    const subcategory = await DiscotecaDB.getSubcategory(subcategoryId);

    sentMessages.length = 0;
    const ctx = fakeCtx({ name: 'generos', authorId: userPlatformId, args: [subcategoryName], platform: 'telegram' });
    await GenerosCommand.execute(ctx, { genre: subcategory! });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain('Nada para mostrar com esses filtros');
  });
});
