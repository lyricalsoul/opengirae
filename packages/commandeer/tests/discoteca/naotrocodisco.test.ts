import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { userDiscoteca } from "@girae/database/schemas/discoteca";
import { eq, and, inArray } from "drizzle-orm";
import { DiscotecaDB } from "@girae/database/discoteca";
import NaoTrocoDiscoCommand from "../../commands/discoteca/naotrocodisco";

mockTelegram();

describe("/naotrocodisco marks one or several discoteca entries as not tradable", () => {
  const fx = new TestFixtures();
  const authorId = "test-naotrocodisco-author";
  let userId: number;
  let entryAId: number, entryBId: number, entryCId: number, unownedEntryId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test NaoTrocoDisco", platform: 'telegram', platformId: authorId })).id;
    entryAId = (await fx.discotecaEntry({ name: `Test NaoTrocoDisco Entry A ${Date.now()}` })).id;
    entryBId = (await fx.discotecaEntry({ name: `Test NaoTrocoDisco Entry B ${Date.now()}` })).id;
    entryCId = (await fx.discotecaEntry({ name: `Test NaoTrocoDisco Entry C ${Date.now()}` })).id;
    unownedEntryId = (await fx.discotecaEntry({ name: `Test NaoTrocoDisco Unowned ${Date.now()}` })).id;

    await db.insert(userDiscoteca).values([
      { userId, entryId: entryAId, count: 1, tradable: true },
      { userId, entryId: entryBId, count: 1, tradable: true },
      { userId, entryId: entryCId, count: 1, tradable: true },
    ]);
    fx.onCleanup(async () => { await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), inArray(userDiscoteca.entryId, [entryAId, entryBId, entryCId, unownedEntryId]))); });
  });

  afterAll(() => fx.cleanup());

  function ctxFor(args: string[]) {
    return fakeCtx({ name: 'naotrocodisco', authorId, args, platform: 'telegram' });
  }

  test("marks a single entry not tradable by ID", async () => {
    await NaoTrocoDiscoCommand.execute(ctxFor([String(entryAId)]), { entriesRaw: String(entryAId) });
    expect(await DiscotecaDB.isEntryTradable(userId, entryAId)).toBe(false);
  });

  test("a not-owned entry by ID replies without throwing and marks nothing", async () => {
    await NaoTrocoDiscoCommand.execute(ctxFor([String(unownedEntryId)]), { entriesRaw: String(unownedEntryId) });
    expect(await DiscotecaDB.isEntryTradable(userId, unownedEntryId)).toBe(false);
  });

  test("marks multiple owned entries not tradable in one command, skipping a not-owned ID", async () => {
    const raw = `${entryBId} ${entryCId} ${unownedEntryId}`;
    await NaoTrocoDiscoCommand.execute(ctxFor(raw.split(' ')), { entriesRaw: raw });

    expect(await DiscotecaDB.isEntryTradable(userId, entryBId)).toBe(false);
    expect(await DiscotecaDB.isEntryTradable(userId, entryCId)).toBe(false);
  });

  test("a bulk request with nothing owned replies without throwing", async () => {
    const raw = `${unownedEntryId} 999999999`;
    await NaoTrocoDiscoCommand.execute(ctxFor(raw.split(' ')), { entriesRaw: raw });
  });
});
