import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { sql, eq } from "drizzle-orm";
import { db } from "../../index";
import { UsersDB, MERGE_KEYED_TABLES, MERGE_PLAIN_REFS } from "../../users";
import { userDiscoteca, discotecaWishlist } from "../../schemas/discoteca";
import { auctionWatches, auctionWatchNotifications, auctions, auctionBids, userCards } from "../../schemas/cards";
import { auditLogs } from "../../schemas/audit";

// FK columns into users that mergeUsers deals with inline, outside the two generic tables
const HANDLED_INLINE = new Set([
  'audit_logs.actorUserId', 'card_draw_history.userId', 'trades.user1Id', 'trades.user2Id', 'user_cards.userId',
  'wishlist.userId', 'linked_accounts.userId', 'user_profiles.userId', 'user_profiles.partnerId', 'bought_items.userId',
  'user_discoteca.userId',
]);

describe("UsersDB.mergeUsers FK coverage", () => {
  test("every foreign key into users is handled, or the final DELETE FROM users aborts the whole /link", async () => {
    const result = await db.execute<{ tbl: string; col: string }>(sql`
      SELECT cl.relname AS tbl, a.attname AS col FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass`);
    const covered = new Set([
      ...HANDLED_INLINE,
      ...MERGE_KEYED_TABLES.map(t => `${t.table}.userId`),
      ...MERGE_PLAIN_REFS.map(r => `${r.table}.${r.column}`),
    ]);
    const missing = result.rows.map(r => `${r.tbl}.${r.col}`).filter(k => !covered.has(k));
    expect(missing).toEqual([]);
  });

  describe("with data on the tables that used to be missed", () => {
    let fx: TestFixtures;
    let mainId: number, secondaryId: number, entryId: number, cardId: number;

    beforeEach(async () => {
      fx = new TestFixtures();
      mainId = (await fx.user({ displayName: "Merge Cov Main" })).id;
      secondaryId = (await fx.user({ displayName: "Merge Cov Secondary", platform: 'discord' })).id;
      entryId = (await fx.discotecaEntry()).id;
      cardId = (await fx.card({ name: `Merge Cov Card ${Bun.randomUUIDv7()}` })).id;
      fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, mainId)); });
    });

    afterEach(() => fx.cleanup());

    test("discoteca copies are summed, wishlist/watches deduped, and the merge completes", async () => {
      await db.insert(userDiscoteca).values([{ userId: mainId, entryId, count: 2 }, { userId: secondaryId, entryId, count: 3 }]);
      await db.insert(discotecaWishlist).values([{ userId: mainId, entryId, position: 0 }, { userId: secondaryId, entryId, position: 0 }]);
      await db.insert(auctionWatches).values([{ userId: mainId, cardId }, { userId: secondaryId, cardId }]);

      await UsersDB.mergeUsers(mainId, secondaryId);

      const [pile] = await db.select().from(userDiscoteca).where(eq(userDiscoteca.userId, mainId));
      expect(pile?.count).toBe(5);
      expect(await db.select().from(discotecaWishlist).where(eq(discotecaWishlist.userId, mainId))).toHaveLength(1);
      expect(await db.select().from(auctionWatches).where(eq(auctionWatches.userId, mainId))).toHaveLength(1);
      expect(await db.select().from(userDiscoteca).where(eq(userDiscoteca.userId, secondaryId))).toHaveLength(0);
    });

    test("an active auction (seller, top bidder, bid history, watch alert) follows the merge", async () => {
      const rarityId = (await fx.rarity({ name: `Merge Cov Rarity ${Bun.randomUUIDv7()}`, auctionBaseValue: 10000 })).id;
      const auctionCardId = (await fx.card({ name: `Merge Cov Auction Card ${Bun.randomUUIDv7()}`, rarityId })).id;
      const other = (await fx.user({ displayName: "Merge Cov Other" })).id;

      const [sellerAuction] = await db.insert(auctions).values({
        sellerId: secondaryId, cardId: auctionCardId, tradable: true, startingBid: 1000, capPrice: 3000, bidIncrement: 500, overtimeIncrement: 1000,
        expiresAt: new Date(Date.now() + 3_600_000),
      }).returning();
      const [bidAuction] = await db.insert(auctions).values({
        sellerId: other, cardId, tradable: true, startingBid: 1000, capPrice: 3000, bidIncrement: 500, overtimeIncrement: 1000,
        currentBid: 1000, currentBidderId: secondaryId, expiresAt: new Date(Date.now() + 3_600_000),
      }).returning();
      await db.insert(auctionBids).values({ auctionId: bidAuction!.id, bidderId: secondaryId, amount: 1000 });
      await db.insert(auctionWatchNotifications).values({ auctionId: sellerAuction!.id, userId: secondaryId });
      fx.onCleanup(async () => {
        await db.delete(auctionWatchNotifications).where(eq(auctionWatchNotifications.auctionId, sellerAuction!.id));
        await db.delete(auctionBids).where(eq(auctionBids.auctionId, bidAuction!.id));
        await db.delete(auctions).where(eq(auctions.id, sellerAuction!.id));
        await db.delete(auctions).where(eq(auctions.id, bidAuction!.id));
        await db.delete(userCards).where(eq(userCards.userId, mainId));
      });

      await UsersDB.mergeUsers(mainId, secondaryId);

      const [s] = await db.select().from(auctions).where(eq(auctions.id, sellerAuction!.id));
      const [b] = await db.select().from(auctions).where(eq(auctions.id, bidAuction!.id));
      expect(s?.sellerId).toBe(mainId);
      expect(b?.currentBidderId).toBe(mainId);
      expect((await db.select().from(auctionBids).where(eq(auctionBids.auctionId, bidAuction!.id)))[0]?.bidderId).toBe(mainId);
    });

    test("merging a secondary that no longer exists throws instead of logging a snapshot-less merge", async () => {
      await UsersDB.mergeUsers(mainId, secondaryId);
      let threw: unknown;
      try { await UsersDB.mergeUsers(mainId, secondaryId); } catch (e) { threw = e; }
      expect(String(threw)).toContain('no longer exists');
    });
  });
});
