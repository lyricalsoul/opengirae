import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, fakeCtx, mockTelegram, bootstrapCommandeerWorkers } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { rarities } from "@girae/database/schemas/cards";
import { userDiscoteca } from "@girae/database/schemas/discoteca";
import { eq, and, inArray } from "drizzle-orm";
import { DiscotecaDB } from "@girae/database/discoteca";
import VenderDiscoCommand from "../../commands/discoteca/venderdisco";

mockTelegram();

describe("/venderdisco", () => {
  const fx = new TestFixtures();
  const platformId = `test-venderdisco-${Date.now()}`;
  let userId: number;
  let entryAId: number, entryBId: number;

  beforeAll(async () => {
    await bootstrapCommandeerWorkers();

    userId = (await fx.user({ displayName: "Test VenderDisco", platform: 'telegram', platformId })).id;
    // the seeded "Comum" rarity, not anyRarityId()'s arbitrary pick - an unrelated rarity can legitimately reward 0.
    const [comum] = await db.select({ id: rarities.id }).from(rarities).where(eq(rarities.name, 'Comum')).limit(1);
    const rarityId = comum!.id;
    entryAId = (await fx.discotecaEntry({ name: `Test VenderDisco Entry A ${Date.now()}`, rarityId })).id;
    entryBId = (await fx.discotecaEntry({ name: `Test VenderDisco Entry B ${Date.now()}`, rarityId })).id;
  });

  afterAll(() => fx.cleanup());

  async function ownedCount(entryId: number): Promise<number> {
    const [row] = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
    return row?.count ?? 0;
  }

  test("confirmed: sells the entry and credits coins", async () => {
    await db.insert(userDiscoteca).values({ userId, entryId: entryAId, count: 1 });
    const [before] = await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId));

    const workflowID = `test-venderdisco-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'venderdisco', authorId: platformId, platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(VenderDiscoCommand, { workflowID }).execute(ctx, { ids: String(entryAId) });
    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: true }, 'venderdisco:confirm');
    await handle.getResult();

    expect(await ownedCount(entryAId)).toBe(0);
    const [after] = await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId));
    expect(after!.coins).toBeGreaterThan(before!.coins);
  });

  test("cancelled: leaves the entry untouched", async () => {
    await db.insert(userDiscoteca).values({ userId, entryId: entryBId, count: 1 });

    const workflowID = `test-venderdisco-cancel-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'venderdisco', authorId: platformId, platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(VenderDiscoCommand, { workflowID }).execute(ctx, { ids: String(entryBId) });
    await new Promise(r => setTimeout(r, 500));
    await DBOS.send(workflowID, { value: false }, 'venderdisco:confirm');
    await handle.getResult();

    expect(await ownedCount(entryBId)).toBe(1);
    await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryBId)));
  });

  test("a not-owned ID replies without throwing", async () => {
    const ctx = fakeCtx({ name: 'venderdisco', authorId: platformId, platform: 'telegram' });
    await VenderDiscoCommand.execute(ctx, { ids: '999999999' });
  });
});
