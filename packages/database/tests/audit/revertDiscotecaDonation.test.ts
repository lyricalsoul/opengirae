import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { AuditDB } from "../../audit";
import { DONATION_REVERT_PENALTY_COINS } from "../../cards";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { userDiscoteca } from "../../schemas/discoteca";
import { auditLogs } from "../../schemas/audit";
import { eq, and, inArray } from "drizzle-orm";

describe("AuditDB.revertDiscotecaDonation", () => {
  let fx: TestFixtures;
  let donorId: number, recipientId: number, adminId: number;
  let rarityId: number;
  let artistId: number;
  let entryAId: number, entryBId: number; // same rarity - entryB is the "same tier" fallback candidate

  beforeEach(async () => {
    fx = new TestFixtures();
    donorId = (await fx.user({ displayName: "Test Disco Revert Donor" })).id;
    recipientId = (await fx.user({ displayName: "Test Disco Revert Recipient" })).id;
    adminId = (await fx.user({ displayName: "Test Disco Revert Admin" })).id;
    rarityId = (await fx.rarity({ name: `Test Disco Revert Rarity ${Bun.randomUUIDv7()}` })).id;
    artistId = (await fx.discotecaArtist({ name: `Test Disco Revert Artist ${Bun.randomUUIDv7()}` })).id;
    entryAId = (await fx.discotecaEntry({ name: "Test Disco Revert Entry A", artistId, rarityId })).id;
    entryBId = (await fx.discotecaEntry({ name: "Test Disco Revert Entry B", artistId, rarityId })).id;

    // default: plenty of draws, no coins - tests override to force a specific fallback branch.
    await db.update(users).set({ usedDraws: 0, maxDraws: 24, coins: 0 }).where(eq(users.id, recipientId));

    // registered last so it LIFO-runs first, before entries/rarity/users get deleted (FK).
    fx.onCleanup(async () => {
      await db.delete(userDiscoteca).where(inArray(userDiscoteca.userId, [donorId, recipientId]));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, donorId));
    });
  });

  afterEach(() => fx.cleanup());

  async function logDonation(entries: { entryId: number; count: number }[]): Promise<number> {
    const row = await AuditDB.log(donorId, "discoteca.doar", { recipientUserId: recipientId, entries });
    return row!.id;
  }

  async function own(userId: number, entryId: number, count: number) {
    await db.insert(userDiscoteca).values({ userId, entryId, count });
  }

  test("takes back the exact donated entry when the recipient still owns it, and returns it to the donor", async () => {
    await own(recipientId, entryAId, 1);
    const logId = await logDonation([{ entryId: entryAId, count: 1 }]);

    const result = await AuditDB.revertDiscotecaDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.donorId).toBe(donorId);
    expect(result.recipientId).toBe(recipientId);
    expect(result.unitOutcomes).toEqual([{ ok: true, penalty: "entry_returned", donatedEntryId: entryAId }]);

    const recipientRow = await db.select().from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, recipientId), eq(userDiscoteca.entryId, entryAId))).then(r => r[0]);
    expect(recipientRow).toBeUndefined();

    const donorRow = await db.select().from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, donorId), eq(userDiscoteca.entryId, entryAId))).then(r => r[0]);
    expect(donorRow?.count).toBe(1);

    const originalLog = await db.select().from(auditLogs).where(eq(auditLogs.id, logId)).then(r => r[0]);
    expect(originalLog?.revertedAt).not.toBeNull();
    expect(originalLog?.revertedByAdminId).toBe(adminId);

    const revertLog = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.actorUserId, donorId), eq(auditLogs.action, "discoteca.doar.revert"))).then(r => r[0]);
    expect(revertLog).toBeDefined();
    expect((revertLog!.metadata as { originalLogId: number }).originalLogId).toBe(logId);
  });

  test("reverting a quantity>1 donation takes back that many individual units", async () => {
    await own(recipientId, entryAId, 3);
    const logId = await logDonation([{ entryId: entryAId, count: 3 }]);

    const result = await AuditDB.revertDiscotecaDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitOutcomes).toEqual([
      { ok: true, penalty: "entry_returned", donatedEntryId: entryAId },
      { ok: true, penalty: "entry_returned", donatedEntryId: entryAId },
      { ok: true, penalty: "entry_returned", donatedEntryId: entryAId },
    ]);

    const recipientRow = await db.select().from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, recipientId), eq(userDiscoteca.entryId, entryAId))).then(r => r[0]);
    expect(recipientRow).toBeUndefined();

    const donorRow = await db.select().from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, donorId), eq(userDiscoteca.entryId, entryAId))).then(r => r[0]);
    expect(donorRow?.count).toBe(3);
  });

  test("falls back to taking a draw when the recipient no longer has the entry", async () => {
    const logId = await logDonation([{ entryId: entryAId, count: 1 }]);

    const result = await AuditDB.revertDiscotecaDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitOutcomes).toEqual([{ ok: true, penalty: "draw_taken", donatedEntryId: entryAId }]);

    const recipient = await db.select().from(users).where(eq(users.id, recipientId)).then(r => r[0]);
    expect(recipient?.usedDraws).toBe(1);

    const donorRow = await db.select().from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, donorId), eq(userDiscoteca.entryId, entryAId))).then(r => r[0]);
    expect(donorRow?.count).toBe(1);
  });

  test("falls back to coins when the recipient has no entry and no draws left", async () => {
    await db.update(users).set({ usedDraws: 24, maxDraws: 24, coins: 5000 }).where(eq(users.id, recipientId));
    const logId = await logDonation([{ entryId: entryAId, count: 1 }]);

    const result = await AuditDB.revertDiscotecaDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitOutcomes).toEqual([
      { ok: true, penalty: "coins_taken", amount: DONATION_REVERT_PENALTY_COINS, donatedEntryId: entryAId },
    ]);

    const recipient = await db.select().from(users).where(eq(users.id, recipientId)).then(r => r[0]);
    expect(recipient?.coins).toBe(5000 - DONATION_REVERT_PENALTY_COINS);
  });

  test("falls back to a same-tier entry when the recipient has no entry, no draws, and no coins", async () => {
    await db.update(users).set({ usedDraws: 24, maxDraws: 24, coins: 0 }).where(eq(users.id, recipientId));
    await own(recipientId, entryBId, 1);
    const logId = await logDonation([{ entryId: entryAId, count: 1 }]);

    const result = await AuditDB.revertDiscotecaDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitOutcomes).toEqual([
      { ok: true, penalty: "same_tier_entry_taken", takenEntryId: entryBId, donatedEntryId: entryAId },
    ]);

    const recipientEntryB = await db.select().from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, recipientId), eq(userDiscoteca.entryId, entryBId))).then(r => r[0]);
    expect(recipientEntryB).toBeUndefined();

    // the donor gets the ORIGINALLY donated entry back, not the substituted same-tier one.
    const donorEntryA = await db.select().from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, donorId), eq(userDiscoteca.entryId, entryAId))).then(r => r[0]);
    expect(donorEntryA?.count).toBe(1);
    const donorEntryB = await db.select().from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, donorId), eq(userDiscoteca.entryId, entryBId))).then(r => r[0]);
    expect(donorEntryB).toBeUndefined();
  });

  test("rolls back entirely (nothing changes) when the recipient has nothing left to take at all", async () => {
    await db.update(users).set({ usedDraws: 24, maxDraws: 24, coins: 0 }).where(eq(users.id, recipientId));
    const logId = await logDonation([{ entryId: entryAId, count: 1 }]);

    const result = await AuditDB.revertDiscotecaDonation(logId, adminId);
    expect(result).toEqual({ ok: false, reason: "nothing_to_penalize", entryId: entryAId });

    const donorRow = await db.select().from(userDiscoteca).where(eq(userDiscoteca.userId, donorId));
    expect(donorRow).toHaveLength(0);

    const originalLog = await db.select().from(auditLogs).where(eq(auditLogs.id, logId)).then(r => r[0]);
    expect(originalLog?.revertedAt).toBeNull();
  });

  test("a donation can't be reverted twice", async () => {
    await own(recipientId, entryAId, 1);
    const logId = await logDonation([{ entryId: entryAId, count: 1 }]);

    const first = await AuditDB.revertDiscotecaDonation(logId, adminId);
    expect(first.ok).toBe(true);

    const second = await AuditDB.revertDiscotecaDonation(logId, adminId);
    expect(second).toEqual({ ok: false, reason: "not_found_or_already_reverted" });
  });

  test("a nonexistent audit log id fails the same way as an already-reverted one", async () => {
    const result = await AuditDB.revertDiscotecaDonation(999999999, adminId);
    expect(result).toEqual({ ok: false, reason: "not_found_or_already_reverted" });
  });
});
