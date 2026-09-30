import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TestFixtures, anyRarityId } from "@girae/tests";
import { db } from "../../index";
import { users, userProfiles, linkedAccounts } from "../../schemas/users";
import { userCards, wishlist } from "../../schemas/cards";
import { boughtItems } from "../../schemas/vanities";
import { auditLogs } from "../../schemas/audit";
import { eq, and } from "drizzle-orm";
import { UsersDB } from "../../users";

// UsersDB.undoLastMergeForUser reverses UsersDB.mergeUsers using the snapshot mergeUsers now
// stores in an audit_logs row (action 'users.merge') - see docs/agent/03-commands.md. These
// tests mirror mergeUsers.test.ts's fixture shape (a fresh main/secondary pair per test) plus
// one extra actor (the "admin" undoing the link).
describe("UsersDB.undoLastMergeForUser", () => {
  let fx: TestFixtures;
  let adminId: number, mainId: number, secondaryId: number;
  let cardAId: number, cardBId: number;
  let itemId: number;

  // undoLastMergeForUser creates a brand-new user row that no TestFixtures call tracks -
  // registered per-test, right after the id is known, so LIFO cleanup order naturally runs
  // this BEFORE any fixture (e.g. a marriage partner) created earlier in the same test body.
  // Nulling out any partnerId still pointing at this id first makes the delete order-safe even
  // when a partner fixture's own cleanup runs later (deleting a row is always safe; deleting a
  // row something ELSE still references as partnerId is not).
  function trackResurrected(id: number) {
    fx.onCleanup(async () => {
      await db.update(userProfiles).set({ isMarried: false, partnerId: null }).where(eq(userProfiles.partnerId, id));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, id));
      await db.delete(userCards).where(eq(userCards.userId, id));
      await db.delete(wishlist).where(eq(wishlist.userId, id));
      await db.delete(boughtItems).where(eq(boughtItems.userId, id));
      await db.delete(userProfiles).where(eq(userProfiles.userId, id));
      await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, id));
      await db.delete(users).where(eq(users.id, id));
    });
  }

  beforeEach(async () => {
    fx = new TestFixtures();
    const rarityId = await anyRarityId();

    adminId = (await fx.user({ displayName: "Test Unlink Admin" })).id;
    mainId = (await fx.user({ displayName: "Main" })).id;
    secondaryId = (await fx.user({ displayName: "Secondary", platform: 'discord' })).id;
    await db.update(users).set({ coins: 100 }).where(eq(users.id, mainId));
    await db.update(users).set({ coins: 50 }).where(eq(users.id, secondaryId));
    await db.update(userProfiles).set({ reputation: 10 }).where(eq(userProfiles.userId, mainId));
    await db.update(userProfiles).set({ reputation: 5 }).where(eq(userProfiles.userId, secondaryId));

    cardAId = (await fx.card({ name: "Unlink Card A", rarityId })).id;
    cardBId = (await fx.card({ name: "Unlink Card B", rarityId })).id;
    itemId = (await fx.storeItem({ title: `Unlink Item ${Date.now()}`, type: 'background', price: 0 })).id;

    fx.onCleanup(async () => {
      await db.delete(userCards).where(eq(userCards.userId, mainId));
      await db.delete(wishlist).where(eq(wishlist.userId, mainId));
      await db.delete(boughtItems).where(eq(boughtItems.userId, mainId));
      await db.delete(userCards).where(eq(userCards.userId, secondaryId));
      await db.delete(wishlist).where(eq(wishlist.userId, secondaryId));
      await db.delete(boughtItems).where(eq(boughtItems.userId, secondaryId));
      // mergeUsers logs 'users.merge' (actorUserId: mainId) and undoLastMergeForUser logs
      // 'users.unlink' (actorUserId: adminId) - both would otherwise FK-block deleting those rows.
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, mainId));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, adminId));
    });
  });

  afterEach(() => fx.cleanup());

  test("no pending merge: refuses with 'no_pending_merge'", async () => {
    const result = await UsersDB.undoLastMergeForUser(mainId, adminId);
    expect(result).toEqual({ ok: false, reason: 'no_pending_merge' });
  });

  test("full reversal: restores coins, reputation, cards, wishlist, bought items and the linked account when nothing changed since the merge", async () => {
    await db.insert(userCards).values([
      { userId: mainId, cardId: cardAId, count: 2 },
      { userId: secondaryId, cardId: cardAId, count: 3 },
      { userId: secondaryId, cardId: cardBId, count: 1 },
    ]);
    await db.insert(wishlist).values([{ userId: secondaryId, cardId: cardBId }]);
    await db.insert(boughtItems).values([{ userId: secondaryId, itemId }]);

    await UsersDB.mergeUsers(mainId, secondaryId);

    const result = await UsersDB.undoLastMergeForUser(mainId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    trackResurrected(result.newSecondaryUserId);

    expect(result.coinsReturned).toBe(50);
    expect(result.coinsShortfall).toBe(0);
    expect(result.reputationReturned).toBe(5);
    expect(result.reputationShortfall).toBe(0);
    expect(result.cardShortfalls).toEqual([]);
    expect(result.movedLinkedAccounts.map(a => a.platform)).toEqual(['discord']);

    const [mainUser] = await db.select().from(users).where(eq(users.id, mainId));
    expect(mainUser!.coins).toBe(100);
    const [mainProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, mainId));
    expect(mainProfile!.reputation).toBe(10);

    const [newUser] = await db.select().from(users).where(eq(users.id, result.newSecondaryUserId));
    expect(newUser!.coins).toBe(50);
    expect(newUser!.displayName).toBe("Secondary");
    const [newProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, result.newSecondaryUserId));
    expect(newProfile!.reputation).toBe(5);

    const mainCards = await db.select().from(userCards).where(eq(userCards.userId, mainId));
    expect(mainCards.find(c => c.cardId === cardAId)?.count).toBe(2);
    expect(mainCards.find(c => c.cardId === cardBId)).toBeUndefined();

    const newCards = await db.select().from(userCards).where(eq(userCards.userId, result.newSecondaryUserId));
    expect(newCards.find(c => c.cardId === cardAId)?.count).toBe(3);
    expect(newCards.find(c => c.cardId === cardBId)?.count).toBe(1);

    const newWishlist = await db.select().from(wishlist).where(eq(wishlist.userId, result.newSecondaryUserId));
    expect(newWishlist.map(w => w.cardId)).toEqual([cardBId]);

    const newBought = await db.select().from(boughtItems).where(eq(boughtItems.userId, result.newSecondaryUserId));
    expect(newBought).toHaveLength(1);

    const links = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, result.newSecondaryUserId));
    expect(links.map(l => l.platform)).toEqual(['discord']);
  });

  test("partial reversal: clamps coins and card counts to what main still has, and reports the shortfall", async () => {
    await db.insert(userCards).values([{ userId: secondaryId, cardId: cardAId, count: 5 }]);
    await UsersDB.mergeUsers(mainId, secondaryId);

    // main spent 20 of its 50 merged coins, and traded away all but 2 of the 5 merged cards.
    await db.update(users).set({ coins: 30 }).where(eq(users.id, mainId));
    await db.update(userCards).set({ count: 2 }).where(and(eq(userCards.userId, mainId), eq(userCards.cardId, cardAId)));

    const result = await UsersDB.undoLastMergeForUser(mainId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    trackResurrected(result.newSecondaryUserId);

    expect(result.coinsReturned).toBe(30);
    expect(result.coinsShortfall).toBe(20); // 50 merged in, only 30 left to claw back
    expect(result.cardShortfalls).toEqual([{ cardId: cardAId, requested: 5, returned: 2 }]);

    const [mainUser] = await db.select().from(users).where(eq(users.id, mainId));
    expect(mainUser!.coins).toBe(0);

    const mainCards = await db.select().from(userCards).where(and(eq(userCards.userId, mainId), eq(userCards.cardId, cardAId)));
    expect(mainCards).toHaveLength(0); // fully clawed back, row deleted rather than left at 0

    const newCards = await db.select().from(userCards).where(eq(userCards.userId, result.newSecondaryUserId));
    expect(newCards.find(c => c.cardId === cardAId)?.count).toBe(2);
  });

  test("a second /unlink on the same merge is refused", async () => {
    await UsersDB.mergeUsers(mainId, secondaryId);

    const first = await UsersDB.undoLastMergeForUser(mainId, adminId);
    expect(first.ok).toBe(true);
    if (first.ok) trackResurrected(first.newSecondaryUserId);

    const second = await UsersDB.undoLastMergeForUser(mainId, adminId);
    expect(second).toEqual({ ok: false, reason: 'no_pending_merge' });
  });

  test("restores a marriage the secondary had to an unrelated partner", async () => {
    const partnerId = (await fx.user({ displayName: "Partner" })).id;
    await db.update(userProfiles).set({ isMarried: true, partnerId: secondaryId }).where(eq(userProfiles.userId, partnerId));
    await db.update(userProfiles).set({ isMarried: true, partnerId }).where(eq(userProfiles.userId, secondaryId));

    await UsersDB.mergeUsers(mainId, secondaryId);

    const result = await UsersDB.undoLastMergeForUser(mainId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    trackResurrected(result.newSecondaryUserId);
    expect(result.restoredMarriages).toBe(1);
    expect(result.failedMarriages).toBe(0);

    const [partnerProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, partnerId));
    expect(partnerProfile!.isMarried).toBe(true);
    expect(partnerProfile!.partnerId).toBe(result.newSecondaryUserId);

    const [newProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, result.newSecondaryUserId));
    expect(newProfile!.isMarried).toBe(true);
    expect(newProfile!.partnerId).toBe(partnerId);
  });

  test("doesn't restore a marriage if the old partner has since remarried", async () => {
    const partnerId = (await fx.user({ displayName: "Partner Remarried" })).id;
    const newSpouseId = (await fx.user({ displayName: "New Spouse" })).id;
    // partnerId and newSpouseId end this test married to EACH OTHER, which fx.user()'s own
    // per-user cleanup doesn't know about - clear that mutual reference before either's own
    // cleanup tries to delete its users row, or the second delete hits a dangling partnerId FK.
    fx.onCleanup(async () => {
      await db.update(userProfiles).set({ isMarried: false, partnerId: null }).where(eq(userProfiles.userId, partnerId));
      await db.update(userProfiles).set({ isMarried: false, partnerId: null }).where(eq(userProfiles.userId, newSpouseId));
    });
    await db.update(userProfiles).set({ isMarried: true, partnerId: secondaryId }).where(eq(userProfiles.userId, partnerId));
    await db.update(userProfiles).set({ isMarried: true, partnerId }).where(eq(userProfiles.userId, secondaryId));

    await UsersDB.mergeUsers(mainId, secondaryId);

    // the old partner moved on after the merge dissolved their marriage.
    await db.update(userProfiles).set({ isMarried: true, partnerId: newSpouseId }).where(eq(userProfiles.userId, partnerId));
    await db.update(userProfiles).set({ isMarried: true, partnerId }).where(eq(userProfiles.userId, newSpouseId));

    const result = await UsersDB.undoLastMergeForUser(mainId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    trackResurrected(result.newSecondaryUserId);
    expect(result.restoredMarriages).toBe(0);
    expect(result.failedMarriages).toBe(1);

    const [partnerProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, partnerId));
    expect(partnerProfile!.partnerId).toBe(newSpouseId); // untouched
  });

  test("restores a mutual marriage between main and secondary without double-processing", async () => {
    await db.update(userProfiles).set({ isMarried: true, partnerId: secondaryId }).where(eq(userProfiles.userId, mainId));
    await db.update(userProfiles).set({ isMarried: true, partnerId: mainId }).where(eq(userProfiles.userId, secondaryId));

    await UsersDB.mergeUsers(mainId, secondaryId);

    const result = await UsersDB.undoLastMergeForUser(mainId, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    trackResurrected(result.newSecondaryUserId);
    expect(result.restoredMarriages).toBe(1); // one pair, not two independent attempts
    expect(result.failedMarriages).toBe(0);

    const [mainProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, mainId));
    expect(mainProfile!.isMarried).toBe(true);
    expect(mainProfile!.partnerId).toBe(result.newSecondaryUserId);

    const [newProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, result.newSecondaryUserId));
    expect(newProfile!.isMarried).toBe(true);
    expect(newProfile!.partnerId).toBe(mainId);
  });

  test("mergeUsers records a claimable 'users.merge' audit log, and undo marks it reverted", async () => {
    await UsersDB.mergeUsers(mainId, secondaryId);

    const [mergeLog] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'users.merge'), eq(auditLogs.actorUserId, mainId)));
    expect(mergeLog).toBeDefined();
    expect(mergeLog!.revertedAt).toBeNull();

    const result = await UsersDB.undoLastMergeForUser(mainId, adminId);
    expect(result.ok).toBe(true);
    if (result.ok) trackResurrected(result.newSecondaryUserId);

    const [revertedLog] = await db.select().from(auditLogs).where(eq(auditLogs.id, mergeLog!.id));
    expect(revertedLog!.revertedAt).not.toBeNull();
    expect(revertedLog!.revertedByAdminId).toBe(adminId);
  });
});
