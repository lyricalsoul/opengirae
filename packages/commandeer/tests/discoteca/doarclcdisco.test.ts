import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { DiscotecaDB } from "@girae/database/discoteca";
import { db } from "@girae/database/index";
import { userDiscoteca } from "@girae/database/schemas/discoteca";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq, and, inArray, sql } from "drizzle-orm";
import DoarClcDiscoCommand from "../../commands/discoteca/doarclcdisco";

const { sentMessages } = mockTelegram();

describe("/doarclcdisco donates every discoteca entry a user owns from one artist", () => {
  const fx = new TestFixtures();
  const donorPlatformId = "test-doarclcdisco-donor";
  const recipientPlatformId = "test-doarclcdisco-recipient";
  let donorId: number, recipientId: number;
  let artistId: number, otherArtistId: number, emptyArtistId: number;
  let entryAId: number, entryBId: number, otherEntryId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    donorId = (await fx.user({ displayName: "Test DoarClcDisco Donor", platform: 'telegram', platformId: donorPlatformId })).id;
    recipientId = (await fx.user({ displayName: "Test DoarClcDisco Recipient", platform: 'telegram', platformId: recipientPlatformId })).id;

    artistId = (await fx.discotecaArtist({ name: `Test DoarClcDisco Artist ${Date.now()}` })).id;
    otherArtistId = (await fx.discotecaArtist({ name: `Test DoarClcDisco Other Artist ${Date.now()}` })).id;
    emptyArtistId = (await fx.discotecaArtist({ name: `Test DoarClcDisco Empty Artist ${Date.now()}` })).id;
    entryAId = (await fx.discotecaEntry({ name: `Test DoarClcDisco Entry A ${Date.now()}`, artistId })).id;
    entryBId = (await fx.discotecaEntry({ name: `Test DoarClcDisco Entry B ${Date.now()}`, artistId })).id;
    otherEntryId = (await fx.discotecaEntry({ name: `Test DoarClcDisco Other Entry ${Date.now()}`, artistId: otherArtistId })).id;

    fx.onCleanup(async () => {
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, donorId));
      await db.delete(userDiscoteca).where(inArray(userDiscoteca.userId, [donorId, recipientId]));
    });
  });

  afterAll(() => fx.cleanup());

  function runCtx(args: string[], workflowID: string) {
    return fakeCtx({ name: 'doarclcdisco', authorId: donorPlatformId, args, platform: 'telegram', workflowID });
  }

  async function ownedCount(userId: number, entryId: number): Promise<number> {
    const [row] = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
    return row?.count ?? 0;
  }

  async function own(userId: number, entryId: number, count: number) {
    // additive upsert (matches CardsDB.addUserCard's semantics) - the self-donation test below returns early, so a plain insert would collide with a later own() on the same id.
    await db.insert(userDiscoteca).values({ userId, entryId, count })
      .onConflictDoUpdate({ target: [userDiscoteca.userId, userDiscoteca.entryId], set: { count: sql`${userDiscoteca.count} + ${count}` } });
  }

  async function runToConfirm(artistArg: string) {
    const workflowID = `test-doarclcdisco-${Bun.randomUUIDv7()}`;
    const ctx = runCtx([recipientPlatformId, artistArg], workflowID);
    const artist = await DiscotecaDB.getArtist(parseInt(artistArg, 10));
    const handle = await DBOS.startWorkflow(DoarClcDiscoCommand, { workflowID }).execute(ctx, { target: recipientPlatformId, artist: artist! });
    await new Promise(r => setTimeout(r, 500));
    return { workflowID, handle };
  }

  test("donates every owned entry from the artist, ignoring entries from other artists", async () => {
    await own(donorId, entryAId, 2);
    await own(donorId, entryBId, 1);
    await own(donorId, otherEntryId, 1);

    const startIndex = sentMessages.length;
    const { workflowID, handle } = await runToConfirm(String(artistId));

    const confirmPrompt = sentMessages.slice(startIndex).find(m => typeof m.text === 'string' && m.text.includes('Doar toda'));
    expect(confirmPrompt).toBeDefined();
    expect(confirmPrompt!.text).toInclude('<strong>3</strong> item(ns)');

    await DBOS.send(workflowID, { value: true }, 'doarclcdisco:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, entryAId)).toBe(0);
    expect(await ownedCount(donorId, entryBId)).toBe(0);
    expect(await ownedCount(recipientId, entryAId)).toBe(2);
    expect(await ownedCount(recipientId, entryBId)).toBe(1);
    expect(await ownedCount(donorId, otherEntryId)).toBe(1);
    expect(await ownedCount(recipientId, otherEntryId)).toBe(0);
  });

  test("cancelling leaves every entry untouched", async () => {
    await own(donorId, entryAId, 1);
    const { workflowID, handle } = await runToConfirm(String(artistId));
    await DBOS.send(workflowID, { value: false }, 'doarclcdisco:confirm');
    await handle.getResult();

    expect(await ownedCount(donorId, entryAId)).toBe(1);
  });

  test("owning nothing from the artist replies without throwing and prompts no confirmation", async () => {
    const workflowID = `test-doarclcdisco-empty-${Bun.randomUUIDv7()}`;
    const ctx = runCtx([recipientPlatformId, String(emptyArtistId)], workflowID);
    const artist = await DiscotecaDB.getArtist(emptyArtistId);
    const handle = await DBOS.startWorkflow(DoarClcDiscoCommand, { workflowID }).execute(ctx, { target: recipientPlatformId, artist: artist! });
    await new Promise(r => setTimeout(r, 500));
    await handle.getResult();
  });

  test("donating to yourself replies without throwing and moves nothing", async () => {
    const before = await ownedCount(donorId, entryAId);
    await own(donorId, entryAId, 1);
    const ctx = fakeCtx({ name: 'doarclcdisco', authorId: donorPlatformId, args: [donorPlatformId, String(artistId)], platform: 'telegram' });
    const artist = await DiscotecaDB.getArtist(artistId);
    await DoarClcDiscoCommand.execute(ctx, { target: donorPlatformId, artist: artist! });
    expect(await ownedCount(donorId, entryAId)).toBe(before + 1);
  });

  test("a TOCTOU race: the donor loses an entry between the confirm prompt and the click", async () => {
    const recipientEntryBBefore = await ownedCount(recipientId, entryBId);
    await own(donorId, entryAId, 1);
    await own(donorId, entryBId, 1);
    const donorEntryBBefore = await ownedCount(donorId, entryBId);
    const { workflowID, handle } = await runToConfirm(String(artistId));

    await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, donorId), eq(userDiscoteca.entryId, entryAId)));

    await DBOS.send(workflowID, { value: true }, 'doarclcdisco:confirm');
    await handle.getResult();

    // the whole donation rolls back - the still-owned entry B must not have moved either
    expect(await ownedCount(donorId, entryBId)).toBe(donorEntryBBefore);
    expect(await ownedCount(recipientId, entryBId)).toBe(recipientEntryBBefore);
  });
});
