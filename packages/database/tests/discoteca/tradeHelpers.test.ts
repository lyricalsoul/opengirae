import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userDiscoteca } from "../../schemas/discoteca";
import { eq, and } from "drizzle-orm";
import { DiscotecaDB, InsufficientDiscotecaEntryError } from "../../discoteca";

describe("DiscotecaDB's trade-support primitives", () => {
  const fx = new TestFixtures();
  let userId: number;
  let entryId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Discoteca Trade User" })).id;
    entryId = (await fx.discotecaEntry()).id;
    fx.onCleanup(async () => { await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId))); });
  });

  afterAll(() => fx.cleanup());

  beforeEach(async () => {
    await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
  });

  describe("setEntryTradable / isEntryTradable", () => {
    test("defaults to false and can be toggled", async () => {
      await db.insert(userDiscoteca).values({ userId, entryId, count: 1 });
      expect(await DiscotecaDB.isEntryTradable(userId, entryId)).toBe(false);

      await DiscotecaDB.setEntryTradable(userId, entryId, true);
      expect(await DiscotecaDB.isEntryTradable(userId, entryId)).toBe(true);

      await DiscotecaDB.setEntryTradable(userId, entryId, false);
      expect(await DiscotecaDB.isEntryTradable(userId, entryId)).toBe(false);
    });

    test("isEntryTradable returns false for an entry the user doesn't own", async () => {
      expect(await DiscotecaDB.isEntryTradable(userId, entryId)).toBe(false);
    });
  });

  describe("decrementForTradeWithClient", () => {
    test("throws when the entry isn't tradable, even with enough count", async () => {
      await db.insert(userDiscoteca).values({ userId, entryId, count: 5, tradable: false });
      // plain try/catch, not expect(...).rejects - that matcher hangs bun test v1.3.14 (03-commands.md).
      let threw: unknown;
      try {
        await db.transaction(client => DiscotecaDB.decrementForTradeWithClient(client, userId, entryId, 1));
      } catch (e) {
        threw = e;
      }
      expect(threw).toBeInstanceOf(InsufficientDiscotecaEntryError);

      const [row] = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
      expect(row?.count).toBe(5); // untouched
    });

    test("throws when tradable but count is insufficient", async () => {
      await db.insert(userDiscoteca).values({ userId, entryId, count: 1, tradable: true });
      let threw: unknown;
      try {
        await db.transaction(client => DiscotecaDB.decrementForTradeWithClient(client, userId, entryId, 2));
      } catch (e) {
        threw = e;
      }
      expect(threw).toBeInstanceOf(InsufficientDiscotecaEntryError);
    });

    test("decrements and deletes the row once it reaches 0", async () => {
      await db.insert(userDiscoteca).values({ userId, entryId, count: 1, tradable: true });
      await db.transaction(client => DiscotecaDB.decrementForTradeWithClient(client, userId, entryId, 1));

      const row = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId))).then(r => r[0]);
      expect(row).toBeUndefined();
    });

    test("decrements partially, keeping the row when count stays above 0", async () => {
      await db.insert(userDiscoteca).values({ userId, entryId, count: 5, tradable: true });
      await db.transaction(client => DiscotecaDB.decrementForTradeWithClient(client, userId, entryId, 2));

      const row = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId))).then(r => r[0]);
      expect(row?.count).toBe(3);
    });
  });

  describe("incrementWithClient", () => {
    test("creates a new row (default not tradable) when the user doesn't own the entry yet", async () => {
      await db.transaction(client => DiscotecaDB.incrementWithClient(client, userId, entryId, 2));

      const row = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId))).then(r => r[0]);
      expect(row?.count).toBe(2);
      expect(row?.tradable).toBe(false);
    });

    test("adds to the existing count without changing tradable", async () => {
      await db.insert(userDiscoteca).values({ userId, entryId, count: 1, tradable: true });
      await db.transaction(client => DiscotecaDB.incrementWithClient(client, userId, entryId, 3));

      const row = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId))).then(r => r[0]);
      expect(row?.count).toBe(4);
      expect(row?.tradable).toBe(true);
    });
  });
});
