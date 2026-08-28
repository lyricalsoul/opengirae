import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { AuditDB } from "../../audit";
import { db } from "../../index";
import { auditLogs } from "../../schemas/audit";
import { userCards } from "../../schemas/cards";
import { eq, and } from "drizzle-orm";

describe("AuditDB.getDonationHistory", () => {
  const fx = new TestFixtures();
  let donorId: number, recipientId: number, adminId: number;
  let categoryId: number, subcategoryId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    donorId = (await fx.user({ displayName: "Test DonationHistory Donor" })).id;
    recipientId = (await fx.user({ displayName: "Test DonationHistory Recipient" })).id;
    // registered before the auditLogs cleanup below so LIFO deletes those rows first (FK).
    adminId = (await fx.user({ displayName: "Test DonationHistory Admin" })).id;
    categoryId = (await fx.category({ name: `Test DonationHistory Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test DonationHistory Subcategory" })).id;
    cardAId = (await fx.card({ name: "Test DonationHistory Card A", subcategoryId })).id;
    cardBId = (await fx.card({ name: "Test DonationHistory Card B", subcategoryId })).id;

    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, donorId)); });

    // an unrelated action type - must never show up in donation history
    await AuditDB.log(donorId, "card.aliasAdd", { cardId: cardAId, cardName: "irrelevant", alias: "irrelevant" });

    await AuditDB.log(donorId, "card.doar", { recipientUserId: recipientId, cardIds: [cardAId, cardBId] });
    await AuditDB.log(donorId, "card.doarclc", { recipientUserId: recipientId, subcategoryId, cardIds: [cardAId, cardBId] });
  });

  afterAll(() => fx.cleanup());

  test("returns only card.doar/card.doarclc entries for that actor, newest first", async () => {
    const { rows, total } = await AuditDB.getDonationHistory(donorId);
    expect(total).toBe(2);
    expect(rows.map(r => r.action)).toEqual(["card.doarclc", "card.doar"]);
  });

  test("resolves the recipient's display name", async () => {
    const { rows } = await AuditDB.getDonationHistory(donorId);
    for (const row of rows) expect(row.recipientName).toBe("Test DonationHistory Recipient");
  });

  test("from the donor's own view, every row is 'sent' and the donor's own name resolves too", async () => {
    const { rows } = await AuditDB.getDonationHistory(donorId);
    for (const row of rows) {
      expect(row.direction).toBe("sent");
      expect(row.donorName).toBe("Test DonationHistory Donor");
    }
  });

  test("the recipient's own view shows the same donations, tagged 'received', with the donor's name", async () => {
    const { rows: donorRows, total: donorTotal } = await AuditDB.getDonationHistory(donorId);
    const { rows: recipientRows, total: recipientTotal } = await AuditDB.getDonationHistory(recipientId);

    expect(recipientTotal).toBe(donorTotal);
    expect(recipientRows.map(r => r.id).sort()).toEqual(donorRows.map(r => r.id).sort());
    for (const row of recipientRows) {
      expect(row.direction).toBe("received");
      expect(row.donorName).toBe("Test DonationHistory Donor");
      expect(row.recipientName).toBe("Test DonationHistory Recipient");
    }
  });

  test("resolves card names/rarity emoji for card.doar", async () => {
    const { rows } = await AuditDB.getDonationHistory(donorId);
    const doar = rows.find(r => r.action === "card.doar")!;
    expect(doar.cards.map(c => c.id).sort()).toEqual([cardAId, cardBId].sort());
    expect(doar.cards.every(c => typeof c.name === "string" && typeof c.rarityEmoji === "string")).toBe(true);
  });

  test("resolves the subcategory name for card.doarclc", async () => {
    const { rows } = await AuditDB.getDonationHistory(donorId);
    const doarclc = rows.find(r => r.action === "card.doarclc")!;
    expect(doarclc.subcategoryName).toBe("Test DonationHistory Subcategory");
  });

  test("a user with no donations gets an empty page, not an error", async () => {
    const bystander = await fx.user({ displayName: "Test DonationHistory Bystander" });
    const { rows, total } = await AuditDB.getDonationHistory(bystander.id);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  test("limit/offset paginate correctly", async () => {
    const page1 = await AuditDB.getDonationHistory(donorId, { limit: 1, offset: 0 });
    const page2 = await AuditDB.getDonationHistory(donorId, { limit: 1, offset: 1 });
    expect(page1.rows).toHaveLength(1);
    expect(page2.rows).toHaveLength(1);
    expect(page1.rows[0]!.id).not.toBe(page2.rows[0]!.id);
    expect(page1.total).toBe(2);
    expect(page2.total).toBe(2);
  });

  test("a fresh row hasn't been reverted", async () => {
    const { rows } = await AuditDB.getDonationHistory(donorId);
    for (const row of rows) {
      expect(row.revertedAt).toBeNull();
      expect(row.revertedByAdminName).toBeNull();
    }
  });

  test("reads per-card quantity from the modern {cardId,count} metadata shape, unlike the legacy distinct-cardIds-only rows logged above", async () => {
    await AuditDB.log(donorId, "card.doar", {
      recipientUserId: recipientId,
      cards: [{ cardId: cardAId, count: 3 }, { cardId: cardBId, count: 1 }],
    });

    const { rows } = await AuditDB.getDonationHistory(donorId, { limit: 10 });
    const withQty = rows.find(r => r.action === "card.doar" && r.cards.some(c => c.count === 3))!;
    expect(withQty).toBeDefined();
    expect(withQty.cards.find(c => c.id === cardAId)?.count).toBe(3);
    expect(withQty.cards.find(c => c.id === cardBId)?.count).toBe(1);
  });

  test("direction:'sent' only returns rows where userId is the donor", async () => {
    const { rows } = await AuditDB.getDonationHistory(donorId, { direction: "sent", limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.direction).toBe("sent");
  });

  test("direction:'received' only returns rows where userId is the recipient", async () => {
    const { rows } = await AuditDB.getDonationHistory(recipientId, { direction: "received", limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.direction).toBe("received");
  });

  test("withUserId narrows to donations between exactly those two users, in either direction", async () => {
    const bystander2 = await fx.user({ displayName: "Test DonationHistory Bystander2" });
    const unrelatedLog = await AuditDB.log(bystander2.id, "card.doar", { recipientUserId: recipientId, cards: [{ cardId: cardAId, count: 1 }] });
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, bystander2.id)); });

    const { rows } = await AuditDB.getDonationHistory(recipientId, { withUserId: donorId, limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.donorUserId === donorId || row.recipientUserId === donorId).toBe(true);
    expect(rows.some(r => r.id === unrelatedLog!.id)).toBe(false);
  });

  test("opts.platform resolves each party's platform id (for building mention() links), null when unset or not linked there", async () => {
    const tgDonor = await fx.user({ displayName: "Test DonationHistory TG Donor", platform: "telegram", platformId: "111222333" });
    const tgRecipient = await fx.user({ displayName: "Test DonationHistory TG Recipient", platform: "telegram", platformId: "444555666" });
    const logRow = await AuditDB.log(tgDonor.id, "card.doar", { recipientUserId: tgRecipient.id, cards: [{ cardId: cardAId, count: 1 }] });
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, tgDonor.id)); });

    const withoutPlatform = await AuditDB.getDonationHistory(tgDonor.id, { limit: 5 });
    const row0 = withoutPlatform.rows.find(r => r.id === logRow!.id)!;
    expect(row0.donorPlatformId).toBeNull();
    expect(row0.recipientPlatformId).toBeNull();

    const withPlatform = await AuditDB.getDonationHistory(tgDonor.id, { limit: 5, platform: "telegram" });
    const row1 = withPlatform.rows.find(r => r.id === logRow!.id)!;
    expect(row1.donorPlatformId).toBe("111222333");
    expect(row1.recipientPlatformId).toBe("444555666");

    // neither is linked on discord - platform ids come back null, not throw/crash.
    const withWrongPlatform = await AuditDB.getDonationHistory(tgDonor.id, { limit: 5, platform: "discord" });
    const row2 = withWrongPlatform.rows.find(r => r.id === logRow!.id)!;
    expect(row2.donorPlatformId).toBeNull();
    expect(row2.recipientPlatformId).toBeNull();
  });

  test("once reverted, resolves the acting admin's display name (not just their id)", async () => {
    const logRow = await AuditDB.log(donorId, "card.doar", { recipientUserId: recipientId, cards: [{ cardId: cardAId, count: 1 }] });
    await fx.ownCard(recipientId, cardAId, 1);
    // the revert moves cardAId onto donorId - fx.ownCard only cleans up the recipientId side.
    fx.onCleanup(async () => { await db.delete(userCards).where(and(eq(userCards.userId, donorId), eq(userCards.cardId, cardAId))); });

    const revertResult = await AuditDB.revertDonation(logRow!.id, adminId);
    expect(revertResult.ok).toBe(true);

    const { rows } = await AuditDB.getDonationHistory(donorId, { limit: 20 });
    const reverted = rows.find(r => r.id === logRow!.id)!;
    expect(reverted.revertedAt).not.toBeNull();
    expect(reverted.revertedByAdminName).toBe("Test DonationHistory Admin");
  });
});
