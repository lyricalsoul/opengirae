import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { AuditDB } from "../../audit";
import { db } from "../../index";
import { auditLogs } from "../../schemas/audit";
import { userDiscoteca } from "../../schemas/discoteca";
import { eq, and } from "drizzle-orm";

describe("AuditDB.getDiscotecaDonationHistory", () => {
  const fx = new TestFixtures();
  let donorId: number, recipientId: number, adminId: number;
  let artistId: number;
  let artistName: string;
  let entryAId: number, entryBId: number;

  beforeAll(async () => {
    donorId = (await fx.user({ displayName: "Test DiscoDonationHistory Donor" })).id;
    recipientId = (await fx.user({ displayName: "Test DiscoDonationHistory Recipient" })).id;
    // registered before the auditLogs cleanup below so LIFO deletes those rows first (FK).
    adminId = (await fx.user({ displayName: "Test DiscoDonationHistory Admin" })).id;
    artistName = `Test DiscoDonationHistory Artist ${Date.now()}`;
    artistId = (await fx.discotecaArtist({ name: artistName })).id;
    entryAId = (await fx.discotecaEntry({ name: "Test DiscoDonationHistory Entry A", artistId })).id;
    entryBId = (await fx.discotecaEntry({ name: "Test DiscoDonationHistory Entry B", artistId })).id;

    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, donorId)); });

    // an unrelated action type - must never show up in donation history
    await AuditDB.log(donorId, "discoteca.entryAliasAdd", { entryId: entryAId, entryName: "irrelevant", alias: "irrelevant" });

    await AuditDB.log(donorId, "discoteca.doar", { recipientUserId: recipientId, entries: [{ entryId: entryAId, count: 1 }, { entryId: entryBId, count: 1 }] });
    await AuditDB.log(donorId, "discoteca.doarclc", { recipientUserId: recipientId, artistId, entries: [{ entryId: entryAId, count: 1 }, { entryId: entryBId, count: 1 }] });
  });

  afterAll(() => fx.cleanup());

  test("returns only discoteca.doar/discoteca.doarclc entries for that actor, newest first", async () => {
    const { rows, total } = await AuditDB.getDiscotecaDonationHistory(donorId);
    expect(total).toBe(2);
    expect(rows.map(r => r.action)).toEqual(["discoteca.doarclc", "discoteca.doar"]);
  });

  test("resolves the recipient's display name", async () => {
    const { rows } = await AuditDB.getDiscotecaDonationHistory(donorId);
    for (const row of rows) expect(row.recipientName).toBe("Test DiscoDonationHistory Recipient");
  });

  test("from the donor's own view, every row is 'sent' and the donor's own name resolves too", async () => {
    const { rows } = await AuditDB.getDiscotecaDonationHistory(donorId);
    for (const row of rows) {
      expect(row.direction).toBe("sent");
      expect(row.donorName).toBe("Test DiscoDonationHistory Donor");
    }
  });

  test("the recipient's own view shows the same donations, tagged 'received', with the donor's name", async () => {
    const { rows: donorRows, total: donorTotal } = await AuditDB.getDiscotecaDonationHistory(donorId);
    const { rows: recipientRows, total: recipientTotal } = await AuditDB.getDiscotecaDonationHistory(recipientId);

    expect(recipientTotal).toBe(donorTotal);
    expect(recipientRows.map(r => r.id).sort()).toEqual(donorRows.map(r => r.id).sort());
    for (const row of recipientRows) {
      expect(row.direction).toBe("received");
      expect(row.donorName).toBe("Test DiscoDonationHistory Donor");
      expect(row.recipientName).toBe("Test DiscoDonationHistory Recipient");
    }
  });

  test("resolves entry names/rarity emoji for discoteca.doar", async () => {
    const { rows } = await AuditDB.getDiscotecaDonationHistory(donorId);
    const doar = rows.find(r => r.action === "discoteca.doar")!;
    expect(doar.entries.map(e => e.id).sort()).toEqual([entryAId, entryBId].sort());
    expect(doar.entries.every(e => typeof e.name === "string" && typeof e.rarityEmoji === "string")).toBe(true);
  });

  test("resolves the artist name for discoteca.doarclc", async () => {
    const { rows } = await AuditDB.getDiscotecaDonationHistory(donorId);
    const doarclc = rows.find(r => r.action === "discoteca.doarclc")!;
    expect(doarclc.artistName).toBe(artistName);
  });

  test("a user with no donations gets an empty page, not an error", async () => {
    const bystander = await fx.user({ displayName: "Test DiscoDonationHistory Bystander" });
    const { rows, total } = await AuditDB.getDiscotecaDonationHistory(bystander.id);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  test("limit/offset paginate correctly", async () => {
    const page1 = await AuditDB.getDiscotecaDonationHistory(donorId, { limit: 1, offset: 0 });
    const page2 = await AuditDB.getDiscotecaDonationHistory(donorId, { limit: 1, offset: 1 });
    expect(page1.rows).toHaveLength(1);
    expect(page2.rows).toHaveLength(1);
    expect(page1.rows[0]!.id).not.toBe(page2.rows[0]!.id);
    expect(page1.total).toBe(2);
    expect(page2.total).toBe(2);
  });

  test("a fresh row hasn't been reverted", async () => {
    const { rows } = await AuditDB.getDiscotecaDonationHistory(donorId);
    for (const row of rows) {
      expect(row.revertedAt).toBeNull();
      expect(row.revertedByAdminName).toBeNull();
    }
  });

  test("reads per-entry quantity from metadata", async () => {
    await AuditDB.log(donorId, "discoteca.doar", {
      recipientUserId: recipientId,
      entries: [{ entryId: entryAId, count: 3 }, { entryId: entryBId, count: 1 }],
    });

    const { rows } = await AuditDB.getDiscotecaDonationHistory(donorId, { limit: 10 });
    const withQty = rows.find(r => r.action === "discoteca.doar" && r.entries.some(e => e.count === 3))!;
    expect(withQty).toBeDefined();
    expect(withQty.entries.find(e => e.id === entryAId)?.count).toBe(3);
    expect(withQty.entries.find(e => e.id === entryBId)?.count).toBe(1);
  });

  test("direction:'sent' only returns rows where userId is the donor", async () => {
    const { rows } = await AuditDB.getDiscotecaDonationHistory(donorId, { direction: "sent", limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.direction).toBe("sent");
  });

  test("direction:'received' only returns rows where userId is the recipient", async () => {
    const { rows } = await AuditDB.getDiscotecaDonationHistory(recipientId, { direction: "received", limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.direction).toBe("received");
  });

  test("withUserId narrows to donations between exactly those two users, in either direction", async () => {
    const bystander2 = await fx.user({ displayName: "Test DiscoDonationHistory Bystander2" });
    const unrelatedLog = await AuditDB.log(bystander2.id, "discoteca.doar", { recipientUserId: recipientId, entries: [{ entryId: entryAId, count: 1 }] });
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, bystander2.id)); });

    const { rows } = await AuditDB.getDiscotecaDonationHistory(recipientId, { withUserId: donorId, limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.donorUserId === donorId || row.recipientUserId === donorId).toBe(true);
    expect(rows.some(r => r.id === unrelatedLog!.id)).toBe(false);
  });

  test("opts.platform resolves each party's platform id (for building mention() links), null when unset or not linked there", async () => {
    const tgDonor = await fx.user({ displayName: "Test DiscoDonationHistory TG Donor", platform: "telegram", platformId: "111222444" });
    const tgRecipient = await fx.user({ displayName: "Test DiscoDonationHistory TG Recipient", platform: "telegram", platformId: "444555777" });
    const logRow = await AuditDB.log(tgDonor.id, "discoteca.doar", { recipientUserId: tgRecipient.id, entries: [{ entryId: entryAId, count: 1 }] });
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, tgDonor.id)); });

    const withoutPlatform = await AuditDB.getDiscotecaDonationHistory(tgDonor.id, { limit: 5 });
    const row0 = withoutPlatform.rows.find(r => r.id === logRow!.id)!;
    expect(row0.donorPlatformId).toBeNull();
    expect(row0.recipientPlatformId).toBeNull();

    const withPlatform = await AuditDB.getDiscotecaDonationHistory(tgDonor.id, { limit: 5, platform: "telegram" });
    const row1 = withPlatform.rows.find(r => r.id === logRow!.id)!;
    expect(row1.donorPlatformId).toBe("111222444");
    expect(row1.recipientPlatformId).toBe("444555777");

    const withWrongPlatform = await AuditDB.getDiscotecaDonationHistory(tgDonor.id, { limit: 5, platform: "discord" });
    const row2 = withWrongPlatform.rows.find(r => r.id === logRow!.id)!;
    expect(row2.donorPlatformId).toBeNull();
    expect(row2.recipientPlatformId).toBeNull();
  });

  test("once reverted, resolves the acting admin's display name (not just their id)", async () => {
    const logRow = await AuditDB.log(donorId, "discoteca.doar", { recipientUserId: recipientId, entries: [{ entryId: entryAId, count: 1 }] });
    await db.insert(userDiscoteca).values({ userId: recipientId, entryId: entryAId, count: 1 });
    // the revert moves entryAId onto donorId - clean up both sides.
    fx.onCleanup(async () => { await db.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, donorId), eq(userDiscoteca.entryId, entryAId))); });

    const revertResult = await AuditDB.revertDiscotecaDonation(logRow!.id, adminId);
    expect(revertResult.ok).toBe(true);

    const { rows } = await AuditDB.getDiscotecaDonationHistory(donorId, { limit: 20 });
    const reverted = rows.find(r => r.id === logRow!.id)!;
    expect(reverted.revertedAt).not.toBeNull();
    expect(reverted.revertedByAdminName).toBe("Test DiscoDonationHistory Admin");
  });
});
