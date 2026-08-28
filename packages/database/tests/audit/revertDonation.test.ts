import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { AuditDB } from "../../audit";
import { DONATION_REVERT_PENALTY_COINS } from "../../cards";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { userCards } from "../../schemas/cards";
import { auditLogs } from "../../schemas/audit";
import { eq, and, inArray } from "drizzle-orm";

describe("AuditDB.revertDonation", () => {
  let fx: TestFixtures;
  let donorId: number, recipientId: number, adminId: number;
  let rarityId: number;
  let cardAId: number, cardBId: number; // same rarity - cardB is the "same tier" fallback candidate

  beforeEach(async () => {
    fx = new TestFixtures();
    donorId = (await fx.user({ displayName: "Test Revert Donor" })).id;
    recipientId = (await fx.user({ displayName: "Test Revert Recipient" })).id;
    adminId = (await fx.user({ displayName: "Test Revert Admin" })).id;
    // dedicated throwaway rarity (not "Comum") so the cativeiro-clearing path stays out of the way.
    rarityId = (await fx.rarity({ name: `Test Revert Rarity ${Bun.randomUUIDv7()}`, cativeiroThreshold: 999 })).id;
    cardAId = (await fx.card({ name: "Test Revert Card A", rarityId })).id;
    cardBId = (await fx.card({ name: "Test Revert Card B", rarityId })).id;

    // default: plenty of draws, no coins - tests override to force a specific fallback branch.
    await db.update(users).set({ usedDraws: 0, maxDraws: 24, coins: 0 }).where(eq(users.id, recipientId));

    // registered last so it LIFO-runs first, before cards/rarity/users get deleted (FK order).
    fx.onCleanup(async () => {
      await db.delete(userCards).where(inArray(userCards.userId, [donorId, recipientId]));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, donorId));
    });
  });

  afterEach(() => fx.cleanup());

  async function logDonation(cards: { cardId: number; count: number }[]): Promise<number> {
    const row = await AuditDB.log(donorId, "card.doar", { recipientUserId: recipientId, cards });
    return row!.id;
  }

  test("takes back the exact donated card when the recipient still owns it, and returns it to the donor", async () => {
    await fx.ownCard(recipientId, cardAId, 1);
    const logId = await logDonation([{ cardId: cardAId, count: 1 }]);

    const result = await AuditDB.revertDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.donorId).toBe(donorId);
    expect(result.recipientId).toBe(recipientId);
    expect(result.unitOutcomes).toEqual([{ ok: true, penalty: "card_returned", donatedCardId: cardAId }]);

    const recipientRow = await db.select().from(userCards)
      .where(and(eq(userCards.userId, recipientId), eq(userCards.cardId, cardAId))).then(r => r[0]);
    expect(recipientRow).toBeUndefined();

    const donorRow = await db.select().from(userCards)
      .where(and(eq(userCards.userId, donorId), eq(userCards.cardId, cardAId))).then(r => r[0]);
    expect(donorRow?.count).toBe(1);

    const originalLog = await db.select().from(auditLogs).where(eq(auditLogs.id, logId)).then(r => r[0]);
    expect(originalLog?.revertedAt).not.toBeNull();
    expect(originalLog?.revertedByAdminId).toBe(adminId);

    const revertLog = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.actorUserId, donorId), eq(auditLogs.action, "card.doar.revert"))).then(r => r[0]);
    expect(revertLog).toBeDefined();
    expect((revertLog!.metadata as { originalLogId: number }).originalLogId).toBe(logId);
  });

  test("reverting a quantity>1 donation takes back that many individual units", async () => {
    await fx.ownCard(recipientId, cardAId, 3);
    const logId = await logDonation([{ cardId: cardAId, count: 3 }]);

    const result = await AuditDB.revertDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitOutcomes).toEqual([
      { ok: true, penalty: "card_returned", donatedCardId: cardAId },
      { ok: true, penalty: "card_returned", donatedCardId: cardAId },
      { ok: true, penalty: "card_returned", donatedCardId: cardAId },
    ]);

    const recipientRow = await db.select().from(userCards)
      .where(and(eq(userCards.userId, recipientId), eq(userCards.cardId, cardAId))).then(r => r[0]);
    expect(recipientRow).toBeUndefined();

    const donorRow = await db.select().from(userCards)
      .where(and(eq(userCards.userId, donorId), eq(userCards.cardId, cardAId))).then(r => r[0]);
    expect(donorRow?.count).toBe(3);
  });

  test("falls back to taking a draw when the recipient no longer has the card", async () => {
    const logId = await logDonation([{ cardId: cardAId, count: 1 }]);

    const result = await AuditDB.revertDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitOutcomes).toEqual([{ ok: true, penalty: "draw_taken", donatedCardId: cardAId }]);

    const recipient = await db.select().from(users).where(eq(users.id, recipientId)).then(r => r[0]);
    expect(recipient?.usedDraws).toBe(1);

    const donorRow = await db.select().from(userCards)
      .where(and(eq(userCards.userId, donorId), eq(userCards.cardId, cardAId))).then(r => r[0]);
    expect(donorRow?.count).toBe(1);
  });

  test("falls back to coins when the recipient has no card and no draws left", async () => {
    await db.update(users).set({ usedDraws: 24, maxDraws: 24, coins: 5000 }).where(eq(users.id, recipientId));
    const logId = await logDonation([{ cardId: cardAId, count: 1 }]);

    const result = await AuditDB.revertDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitOutcomes).toEqual([
      { ok: true, penalty: "coins_taken", amount: DONATION_REVERT_PENALTY_COINS, donatedCardId: cardAId },
    ]);

    const recipient = await db.select().from(users).where(eq(users.id, recipientId)).then(r => r[0]);
    expect(recipient?.coins).toBe(5000 - DONATION_REVERT_PENALTY_COINS);
  });

  test("falls back to a same-tier card when the recipient has no card, no draws, and no coins", async () => {
    await db.update(users).set({ usedDraws: 24, maxDraws: 24, coins: 0 }).where(eq(users.id, recipientId));
    await fx.ownCard(recipientId, cardBId, 1);
    const logId = await logDonation([{ cardId: cardAId, count: 1 }]);

    const result = await AuditDB.revertDonation(logId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitOutcomes).toEqual([
      { ok: true, penalty: "same_tier_card_taken", takenCardId: cardBId, donatedCardId: cardAId },
    ]);

    const recipientCardB = await db.select().from(userCards)
      .where(and(eq(userCards.userId, recipientId), eq(userCards.cardId, cardBId))).then(r => r[0]);
    expect(recipientCardB).toBeUndefined();

    // the donor gets the ORIGINALLY donated card back, not the substituted same-tier one.
    const donorCardA = await db.select().from(userCards)
      .where(and(eq(userCards.userId, donorId), eq(userCards.cardId, cardAId))).then(r => r[0]);
    expect(donorCardA?.count).toBe(1);
    const donorCardB = await db.select().from(userCards)
      .where(and(eq(userCards.userId, donorId), eq(userCards.cardId, cardBId))).then(r => r[0]);
    expect(donorCardB).toBeUndefined();
  });

  test("rolls back entirely (nothing changes) when the recipient has nothing left to take at all", async () => {
    await db.update(users).set({ usedDraws: 24, maxDraws: 24, coins: 0 }).where(eq(users.id, recipientId));
    const logId = await logDonation([{ cardId: cardAId, count: 1 }]);

    const result = await AuditDB.revertDonation(logId, adminId);
    expect(result).toEqual({ ok: false, reason: "nothing_to_penalize", cardId: cardAId });

    const donorRow = await db.select().from(userCards).where(eq(userCards.userId, donorId));
    expect(donorRow).toHaveLength(0);

    const originalLog = await db.select().from(auditLogs).where(eq(auditLogs.id, logId)).then(r => r[0]);
    expect(originalLog?.revertedAt).toBeNull();
  });

  test("a donation can't be reverted twice", async () => {
    await fx.ownCard(recipientId, cardAId, 1);
    const logId = await logDonation([{ cardId: cardAId, count: 1 }]);

    const first = await AuditDB.revertDonation(logId, adminId);
    expect(first.ok).toBe(true);

    const second = await AuditDB.revertDonation(logId, adminId);
    expect(second).toEqual({ ok: false, reason: "not_found_or_already_reverted" });
  });

  test("a nonexistent audit log id fails the same way as an already-reverted one", async () => {
    const result = await AuditDB.revertDonation(999999999, adminId);
    expect(result).toEqual({ ok: false, reason: "not_found_or_already_reverted" });
  });
});
