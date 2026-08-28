import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { userDiscoteca } from "@girae/database/schemas/discoteca";
import { eq, and, inArray } from "drizzle-orm";
import { DiscotecaDB } from "@girae/database/discoteca";
import TrocoDiscoCommand from "../../commands/discoteca/trocodisco";

mockTelegram();

describe("/trocodisco marks one or several discoteca entries as tradable", () => {
  const fx = new TestFixtures();
  const authorId = "test-trocodisco-author";
  let userId: number;
  let entryAId: number, entryBId: number, entryCId: number, unownedEntryId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test TrocoDisco", platform: 'telegram', platformId: authorId })).id;
    entryAId = (await fx.discotecaEntry({ name: `Test TrocoDisco Entry A ${Date.now()}` })).id;
    entryBId = (await fx.discotecaEntry({ name: `Test TrocoDisco Entry B ${Date.now()}` })).id;
    entryCId = (await fx.discotecaEntry({ name: `Test TrocoDisco Entry C ${Date.now()}` })).id;
    unownedEntryId = (await fx.discotecaEntry({ name: `Test TrocoDisco Unowned ${Date.now()}` })).id;

    await db.insert(userDiscoteca).values([
      { userId, entryId: entryAId, count: 1 },
      { userId, entryId: entryBId, count: 1 },
      { userId, entryId: entryCId, count: 1 },
    ]);
    fx.onCleanup(async () => { await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), inArray(userDiscoteca.entryId, [entryAId, entryBId, entryCId, unownedEntryId]))); });
  });

  afterAll(() => fx.cleanup());

  function ctxFor(args: string[]) {
    return fakeCtx({ name: 'trocodisco', authorId, args, platform: 'telegram' });
  }

  test("marks a single entry tradable by ID", async () => {
    await TrocoDiscoCommand.execute(ctxFor([String(entryAId)]), { entriesRaw: String(entryAId) });
    expect(await DiscotecaDB.isEntryTradable(userId, entryAId)).toBe(true);
  });

  test("a not-owned entry by ID replies without throwing and marks nothing", async () => {
    await TrocoDiscoCommand.execute(ctxFor([String(unownedEntryId)]), { entriesRaw: String(unownedEntryId) });
    expect(await DiscotecaDB.isEntryTradable(userId, unownedEntryId)).toBe(false);
  });

  test("marks multiple owned entries tradable in one command, skipping a not-owned ID", async () => {
    const raw = `${entryBId} ${entryCId} ${unownedEntryId}`;
    await TrocoDiscoCommand.execute(ctxFor(raw.split(' ')), { entriesRaw: raw });

    expect(await DiscotecaDB.isEntryTradable(userId, entryBId)).toBe(true);
    expect(await DiscotecaDB.isEntryTradable(userId, entryCId)).toBe(true);
    expect(await DiscotecaDB.isEntryTradable(userId, unownedEntryId)).toBe(false);
  });

  test("a bulk request with nothing owned replies without throwing", async () => {
    const raw = `${unownedEntryId} 999999999`;
    await TrocoDiscoCommand.execute(ctxFor(raw.split(' ')), { entriesRaw: raw });
  });
});
