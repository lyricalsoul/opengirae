import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userDiscoteca } from "../../schemas/discoteca";
import { eq, and, inArray } from "drizzle-orm";
import { DiscotecaDB, InsufficientDiscotecaEntryError } from "../../discoteca";

// plain try/catch, not expect(promise).rejects - that matcher hangs bun test v1.3.14 (03-commands.md).
async function captureRejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("DiscotecaDB's donation primitives (/doardisco, /doarclcdisco)", () => {
  const fx = new TestFixtures();
  let donorId: number, recipientId: number;
  let entryAId: number, entryBId: number;

  beforeAll(async () => {
    donorId = (await fx.user({ displayName: "Test Donation Donor" })).id;
    recipientId = (await fx.user({ displayName: "Test Donation Recipient" })).id;
    entryAId = (await fx.discotecaEntry({ name: "Test Donation Entry A" })).id;
    entryBId = (await fx.discotecaEntry({ name: "Test Donation Entry B" })).id;

    fx.onCleanup(async () => { await db.delete(userDiscoteca).where(inArray(userDiscoteca.userId, [donorId, recipientId])); });
  });

  afterAll(() => fx.cleanup());

  beforeEach(async () => {
    await db.delete(userDiscoteca).where(inArray(userDiscoteca.userId, [donorId, recipientId]));
  });

  async function ownedCount(userId: number, entryId: number): Promise<number> {
    const [row] = await db.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
    return row?.count ?? 0;
  }

  describe("getAllOwnedEntryIds", () => {
    test("returns every entry the user owns at least one of", async () => {
      await db.insert(userDiscoteca).values([
        { userId: donorId, entryId: entryAId, count: 2 },
        { userId: donorId, entryId: entryBId, count: 1 },
      ]);

      const owned = await DiscotecaDB.getAllOwnedEntryIds(donorId);
      const byId = new Map(owned.map(o => [o.entryId, o.count]));
      expect(byId.get(entryAId)).toBe(2);
      expect(byId.get(entryBId)).toBe(1);
    });
  });

  describe("decrementForDonationWithClient", () => {
    test("succeeds even when the entry is not marked tradable (donations bypass the trade-only flag)", async () => {
      await db.insert(userDiscoteca).values({ userId: donorId, entryId: entryAId, count: 1, tradable: false });
      await db.transaction(client => DiscotecaDB.decrementForDonationWithClient(client, donorId, entryAId, 1));

      expect(await ownedCount(donorId, entryAId)).toBe(0);
    });

    test("throws when the count is insufficient", async () => {
      await db.insert(userDiscoteca).values({ userId: donorId, entryId: entryAId, count: 1 });
      const err = await captureRejection(db.transaction(client => DiscotecaDB.decrementForDonationWithClient(client, donorId, entryAId, 2)));
      expect(err).toBeInstanceOf(InsufficientDiscotecaEntryError);
      expect(await ownedCount(donorId, entryAId)).toBe(1); // untouched
    });
  });

  describe("executeDonation", () => {
    test("moves a one-sided offer from donor to recipient atomically", async () => {
      await db.insert(userDiscoteca).values([
        { userId: donorId, entryId: entryAId, count: 2, tradable: false },
        { userId: donorId, entryId: entryBId, count: 1, tradable: false },
      ]);

      await DiscotecaDB.executeDonation(donorId, [{ entryId: entryAId, count: 2 }, { entryId: entryBId, count: 1 }], recipientId);

      expect(await ownedCount(donorId, entryAId)).toBe(0);
      expect(await ownedCount(donorId, entryBId)).toBe(0);
      expect(await ownedCount(recipientId, entryAId)).toBe(2);
      expect(await ownedCount(recipientId, entryBId)).toBe(1);
    });

    test("insufficient count on one entry rolls back an already-decremented entry in the same offer", async () => {
      await db.insert(userDiscoteca).values({ userId: donorId, entryId: entryAId, count: 1, tradable: false });
      // donor does NOT have entryB

      const err = await captureRejection(DiscotecaDB.executeDonation(donorId, [{ entryId: entryAId, count: 1 }, { entryId: entryBId, count: 1 }], recipientId));
      expect(err).toBeInstanceOf(InsufficientDiscotecaEntryError);

      expect(await ownedCount(donorId, entryAId)).toBe(1); // rolled back
      expect(await ownedCount(recipientId, entryAId)).toBe(0);
    });

    test("rejects donating to yourself", async () => {
      const err = await captureRejection(DiscotecaDB.executeDonation(donorId, [{ entryId: entryAId, count: 1 }], donorId));
      expect((err as Error)?.message).toContain('donorId and recipientId must differ');
    });

    test("rejects an offer that lists the same entry twice", async () => {
      const err = await captureRejection(DiscotecaDB.executeDonation(donorId, [{ entryId: entryAId, count: 1 }, { entryId: entryAId, count: 1 }], recipientId));
      expect((err as Error)?.message).toContain('same discoteca entry twice');
    });

    test("rejects a non-positive count", async () => {
      const err = await captureRejection(DiscotecaDB.executeDonation(donorId, [{ entryId: entryAId, count: 0 }], recipientId));
      expect((err as Error)?.message).toContain('must be positive');
    });
  });
});
