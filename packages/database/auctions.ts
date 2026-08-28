import { maybeTransaction, type DrizzleClient } from "./decorators";
import { db } from "./index";
import { auctions, auctionBids, cards, rarities, userCards, cardSubcategories, subcategories, categories } from "./schemas/cards";
import { economy } from "./schemas/economy";
import { users } from "./schemas/users";
import { eq, and, or, sql, gte, lte, inArray, ilike, desc, asc, isNull } from "drizzle-orm";
import { EconomyDB } from "./economy";

export type Auction = typeof auctions.$inferSelect;

const AUCTION_DURATION_MS = 60 * 60 * 1000; // 1h
const ANTI_SNIPE_WINDOW_MS = 2 * 60 * 1000; // last 2min of the current expiresAt
const ANTI_SNIPE_EXTENSION_MS = 2 * 60 * 1000;
const BID_UNIT = 500;
const OVERTIME_UNIT = 2000;
const CAP_MULTIPLIER = 3;
const MAX_AUCTIONS_PER_DAY = 3;
const RELIST_COOLDOWN_MS = 30 * 60 * 1000;

// used for bidIncrement/overtimeIncrement, which define the grid everything else lands on.
function scaleAndRound(referenceValue: number, inflationRate: number): number {
  return Math.max(BID_UNIT, Math.round((referenceValue * inflationRate) / BID_UNIT) * BID_UNIT);
}

// keeps startingBid/capPrice aligned to the auction's own bidIncrement, so a bid at exactly the advertised startingBid is never rejected as an off-step amount.
function roundToGrid(value: number, unit: number): number {
  return Math.max(unit, Math.round(value / unit) * unit);
}

function queryAsCardId(query: string | undefined): number | undefined {
  const trimmed = query?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : undefined;
}

export class AuctionCreateError extends Error {
  // retryAfterMs is only set for reason 'cooldown'. No 'insufficient_coins' - creating a listing is free.
  constructor(public reason: 'auctions_disabled' | 'daily_limit' | 'rarity_not_configured' | 'not_owned' | 'cooldown' | 'already_active', public retryAfterMs?: number) {
    super(`createAuction failed: ${reason}`);
  }
}

export class AuctionBidError extends Error {
  constructor(public reason: 'auctions_disabled' | 'not_found' | 'not_active' | 'expired' | 'self_bid' | 'self_rebid' | 'not_a_valid_step' | 'below_minimum' | 'above_cap' | 'insufficient_coins') {
    super(`placeBid failed: ${reason}`);
  }
}

export class AuctionCancelError extends Error {
  constructor(public reason: 'not_found' | 'not_owner') {
    super(`cancelAuction failed: ${reason}`);
  }
}

export class AuctionForceCloseError extends Error {
  constructor(public reason: 'not_found') {
    super(`forceCloseAuction failed: ${reason}`);
  }
}

// shared by /lance and the site's "lance mínimo" button, so both suggest exactly what placeBid will accept.
export function computeMinimumBid(auction: Pick<Auction, 'currentBid' | 'startingBid' | 'bidIncrement' | 'overtimeIncrement' | 'expiresAt'>, now: Date = new Date()): number {
  const inOvertime = auction.expiresAt.getTime() - now.getTime() < ANTI_SNIPE_WINDOW_MS;
  if (auction.currentBid === null) return auction.startingBid;
  return auction.currentBid + (inOvertime ? auction.overtimeIncrement : auction.bidIncrement);
}

export class AuctionsDB {
  static getAuction = maybeTransaction('getAuction', async (client, id: number) => {
    return await client
      .select({
        auction: auctions,
        cardName: cards.name,
        cardImageUrl: cards.imageUrl,
        rarityEmoji: rarities.emoji,
        sellerName: users.displayName,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
        subcategoryName: subcategories.name,
      })
      .from(auctions)
      .innerJoin(cards, eq(cards.id, auctions.cardId))
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .innerJoin(users, eq(users.id, auctions.sellerId))
      .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(eq(auctions.id, id))
      .limit(1)
      .then(a => a?.[0]);
  })

  // used by /card - the unit is physically out of userCards while auctioned, so callers can't just check ownership.
  static getActiveAuctionForSellerCard = maybeTransaction('getActiveAuctionForSellerCard', async (client, sellerId: number, cardId: number) => {
    return await client
      .select({ id: auctions.id })
      .from(auctions)
      .where(and(eq(auctions.sellerId, sellerId), eq(auctions.cardId, cardId), eq(auctions.status, 'active')))
      .limit(1)
      .then(a => a?.[0]);
  })

  // `status` defaults to 'active'; pass `status: null` explicitly for the admin "every state" view.
  static listActiveAuctions = maybeTransaction('listActiveAuctions', async (client, opts: { query?: string; limit?: number; offset?: number; status?: Auction['status'] | null; categoryId?: number; sellerId?: number; biddingUserId?: number; sortBy?: 'recent' | 'urgency' } = {}) => {
    const query = opts.query;
    const limit: number = opts.limit ?? 20;
    const offset: number = opts.offset ?? 0;
    // 'urgency' matches listActiveAuctionsByCategory's preview order, so the mini app's "ver mais" reads consistently with the preview it came from.
    const orderBy = opts.sortBy === 'urgency' ? [asc(rarities.weight), asc(auctions.expiresAt)] : [desc(auctions.createdAt)];
    const statusFilter = opts.status === undefined ? 'active' : opts.status;
    const statusCondition = statusFilter ? eq(auctions.status, statusFilter) : undefined;
    // matches the card's own id, its name, OR its (main) subcategory's name - same "search by collection" behavior as ColecoesTab.
    const queryCardId = queryAsCardId(query);
    const queryCondition = query
      ? or(
        ilike(cards.name, `%${query}%`),
        sql`EXISTS (SELECT 1 FROM ${cardSubcategories} cs JOIN ${subcategories} sc ON sc.id = cs."subcategoryId" WHERE cs."cardId" = ${cards.id} AND cs."isMain" = true AND sc.name ILIKE ${`%${query}%`})`,
        ...(queryCardId !== undefined ? [eq(cards.id, queryCardId)] : []),
      )
      : undefined;
    // avoids an unconditional join to subcategories/categories for the common (no category filter) case.
    const categoryCondition = opts.categoryId !== undefined
      ? sql`EXISTS (SELECT 1 FROM ${cardSubcategories} cs JOIN ${subcategories} sc ON sc.id = cs."subcategoryId" WHERE cs."cardId" = ${cards.id} AND cs."isMain" = true AND sc."categoryId" = ${opts.categoryId})`
      : undefined;
    // "meus leilões" - the seller's own listings across every status, not just active.
    const sellerCondition = opts.sellerId !== undefined ? eq(auctions.sellerId, opts.sellerId) : undefined;
    // "a licitar" - every auction this user has ever bid on, current top bid or not, across every status.
    const biddingCondition = opts.biddingUserId !== undefined
      ? sql`EXISTS (SELECT 1 FROM ${auctionBids} b WHERE b."auctionId" = ${auctions.id} AND b."bidderId" = ${opts.biddingUserId})`
      : undefined;
    const conditions = [statusCondition, queryCondition, categoryCondition, sellerCondition, biddingCondition].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, total] = await Promise.all([
      client
        .select({
          auction: auctions,
          cardName: cards.name,
          cardImageUrl: cards.imageUrl,
          rarityEmoji: rarities.emoji,
          sellerName: users.displayName,
        })
        .from(auctions)
        .innerJoin(cards, eq(cards.id, auctions.cardId))
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .innerJoin(users, eq(users.id, auctions.sellerId))
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
      client
        .select({ total: sql<number>`count(*)::int` })
        .from(auctions)
        .innerJoin(cards, eq(cards.id, auctions.cardId))
        .where(where)
        .then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total };
  })

  // grouped-by-category listing, same pagination-at-the-section-level pattern as CardsDB.getUserOwnedCardsBySubcategory (just grouped by category instead of subcategory).
  static listActiveAuctionsByCategory = maybeTransaction('listActiveAuctionsByCategory', async (
    client, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const PREVIEW_CAP = 5;
    const query = opts.query;
    const limit: number = opts.limit ?? 10;
    const offset: number = opts.offset ?? 0;
    // matches card id/name/subcategory name - subcategories is already joined here for the category grouping, so no extra EXISTS needed (contrast with listActiveAuctions above).
    const queryCardId = queryAsCardId(query);
    const cardMatch = query
      ? or(
        ilike(cards.name, `%${query}%`),
        ilike(subcategories.name, `%${query}%`),
        ...(queryCardId !== undefined ? [eq(cards.id, queryCardId)] : []),
      )
      : undefined;
    const where = cardMatch ? and(eq(auctions.status, 'active'), cardMatch) : eq(auctions.status, 'active');

    const [categoryRows, totalCategories] = await Promise.all([
      client
        .select({
          categoryId: categories.id,
          categoryName: categories.name,
          categoryEmoji: categories.emoji,
          total: sql<number>`CAST(COUNT(*) AS INTEGER)`,
        })
        .from(auctions)
        .innerJoin(cards, eq(cards.id, auctions.cardId))
        .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .innerJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(where)
        .groupBy(categories.id)
        .orderBy(categories.id)
        .limit(limit)
        .offset(offset),
      client
        .select({ total: sql<number>`CAST(COUNT(DISTINCT ${categories.id}) AS INTEGER)` })
        .from(auctions)
        .innerJoin(cards, eq(cards.id, auctions.cardId))
        .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .innerJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(where)
        .then(r => r[0]?.total ?? 0),
    ]);

    type AuctionRow = { categoryId: number; auction: Auction; cardName: string; cardImageUrl: string | null; rarityEmoji: string; sellerName: string };
    const categoryIds = categoryRows.map(r => r.categoryId);
    const auctionsByCategory = new Map<number, AuctionRow[]>();

    if (categoryIds.length > 0) {
      const auctionWhere = cardMatch
        ? and(eq(auctions.status, 'active'), inArray(categories.id, categoryIds), cardMatch)
        : and(eq(auctions.status, 'active'), inArray(categories.id, categoryIds));

      const auctionRows = await client
        .select({
          categoryId: categories.id,
          auction: auctions,
          cardName: cards.name,
          cardImageUrl: cards.imageUrl,
          rarityEmoji: rarities.emoji,
          sellerName: users.displayName,
        })
        .from(auctions)
        .innerJoin(cards, eq(cards.id, auctions.cardId))
        .innerJoin(rarities, eq(rarities.id, cards.rarityId))
        .innerJoin(users, eq(users.id, auctions.sellerId))
        .innerJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .innerJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(auctionWhere)
        // preview slots favor the rarest cards first, then whichever is closest to closing within the same rarity tier.
        .orderBy(asc(rarities.weight), asc(auctions.expiresAt));

      for (const row of auctionRows) {
        const list = auctionsByCategory.get(row.categoryId) ?? [];
        if (list.length < PREVIEW_CAP) list.push(row);
        auctionsByCategory.set(row.categoryId, list);
      }
    }

    const rows = categoryRows.map(cat => ({
      ...cat,
      auctions: auctionsByCategory.get(cat.categoryId) ?? [],
    }));

    return { rows, total: totalCategories };
  })

  // preview-only, no writes - listing is free; saleFeeRate here is informational, charged only at settlement.
  static previewAuctionTerms = async (cardId: number) => {
    const [state, cardRow] = await Promise.all([
      EconomyDB.getState(),
      db.select({ auctionBaseValue: rarities.auctionBaseValue }).from(cards).innerJoin(rarities, eq(rarities.id, cards.rarityId)).where(eq(cards.id, cardId)).limit(1).then(a => a?.[0]),
    ]);
    if (!cardRow || cardRow.auctionBaseValue <= 0) return null;

    const bidIncrement = scaleAndRound(BID_UNIT, state.inflationRate);
    const startingBid = roundToGrid(cardRow.auctionBaseValue * state.inflationRate, bidIncrement);
    return { startingBid, capPrice: startingBid * CAP_MULTIPLIER, saleFeeRate: state.auctionSaleFeeRate };
  }

  static getRecentBids = maybeTransaction('getRecentBids', async (client, auctionId: number, limit: number = 20) => {
    return await client
      .select({ id: auctionBids.id, bidderId: auctionBids.bidderId, bidderName: users.displayName, bidderAvatarUrl: users.avatarUrl, amount: auctionBids.amount, createdAt: auctionBids.createdAt })
      .from(auctionBids)
      .innerJoin(users, eq(users.id, auctionBids.bidderId))
      .where(eq(auctionBids.auctionId, auctionId))
      .orderBy(desc(auctionBids.id))
      .limit(limit);
  })

  static createAuction = async (sellerId: number, cardId: number) => {
    try {
      const auction = await AuctionsDB.createAuctionTx(sellerId, cardId);
      return { ok: true as const, auction };
    } catch (e) {
      if (e instanceof AuctionCreateError) return { ok: false as const, reason: e.reason, retryAfterMs: e.retryAfterMs };
      // the partial unique index (sellerId, cardId) WHERE status='active' is the real TOCTOU guard - same pattern as CardsDB.applyHipoteca's 23505 catch.
      const code = (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === '23505') return { ok: false as const, reason: 'already_active' as const };
      throw e;
    }
  }

  private static createAuctionTx = maybeTransaction('createAuction', async (client, sellerId: number, cardId: number) => {
    const state = await client.select().from(economy).limit(1).then(r => r[0]!);
    if (!state.auctionsEnabled) throw new AuctionCreateError('auctions_disabled');

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const createdToday = await client
      .select({ count: sql<number>`count(*)::int` })
      .from(auctions)
      .where(and(eq(auctions.sellerId, sellerId), gte(auctions.createdAt, startOfToday)))
      .then(r => r[0]?.count ?? 0);
    if (createdToday >= MAX_AUCTIONS_PER_DAY) throw new AuctionCreateError('daily_limit');

    const cardRow = await client
      .select({ auctionBaseValue: rarities.auctionBaseValue, cativeiroThreshold: rarities.cativeiroThreshold })
      .from(cards)
      .innerJoin(rarities, eq(rarities.id, cards.rarityId))
      .where(eq(cards.id, cardId))
      .limit(1)
      .then(a => a?.[0]);
    if (!cardRow || cardRow.auctionBaseValue <= 0) throw new AuctionCreateError('rarity_not_configured');

    const cooldownCutoff = new Date(Date.now() - RELIST_COOLDOWN_MS);
    const [cooldownHit] = await client
      .select({ id: auctions.id, resolvedAt: auctions.resolvedAt })
      .from(auctions)
      .where(and(
        eq(auctions.sellerId, sellerId),
        eq(auctions.cardId, cardId),
        inArray(auctions.status, ['expired', 'cancelled']),
        gte(auctions.resolvedAt, cooldownCutoff),
      ))
      .orderBy(desc(auctions.resolvedAt))
      .limit(1);
    if (cooldownHit) throw new AuctionCreateError('cooldown', (cooldownHit.resolvedAt!.getTime() + RELIST_COOLDOWN_MS) - Date.now());

    const bidIncrement = scaleAndRound(BID_UNIT, state.inflationRate);
    const overtimeIncrement = roundToGrid(OVERTIME_UNIT * state.inflationRate, bidIncrement);
    const startingBid = roundToGrid(cardRow.auctionBaseValue * state.inflationRate, bidIncrement);
    const capPrice = startingBid * CAP_MULTIPLIER;

    // TOCTOU-safe: ownership + tradable + "at least 1 copy" folded into one conditional UPDATE, same shape as executeTrade's `decrement`.
    const [decremented] = await client
      .update(userCards)
      .set({ count: sql`${userCards.count} - 1` })
      .where(and(eq(userCards.userId, sellerId), eq(userCards.cardId, cardId), gte(userCards.count, 1), eq(userCards.tradable, true)))
      .returning();
    if (!decremented) throw new AuctionCreateError('not_owned');

    if (decremented.count === 0) {
      await client.delete(userCards).where(and(eq(userCards.userId, sellerId), eq(userCards.cardId, cardId)));
    } else if (decremented.count < cardRow.cativeiroThreshold) {
      // remaining stock dropped below the customization unlock - same rule executeTrade applies
      await client.update(userCards).set({ customEmoji: null, customMediaUrl: null, customMediaType: null })
        .where(and(eq(userCards.userId, sellerId), eq(userCards.cardId, cardId)));
    }

    // listing is free - the seller pays nothing here; the sale commission (economy.auctionSaleFeeRate) is only taken out of currentBid at settlement, see settleAuction.
    const now = new Date();
    const [auction] = await client.insert(auctions).values({
      sellerId, cardId,
      tradable: decremented.tradable, customEmoji: decremented.customEmoji, customMediaUrl: decremented.customMediaUrl, customMediaType: decremented.customMediaType,
      startingBid, capPrice, bidIncrement, overtimeIncrement,
      expiresAt: new Date(now.getTime() + AUCTION_DURATION_MS),
    }).returning();

    return auction!;
  })

  static placeBid = async (auctionId: number, bidderId: number, amount: number, opts: { allowSelfRebid?: boolean } = {}) => {
    try {
      const result = await AuctionsDB.placeBidTx(auctionId, bidderId, amount, opts.allowSelfRebid ?? false);
      return { ok: true as const, ...result };
    } catch (e) {
      if (e instanceof AuctionBidError) return { ok: false as const, reason: e.reason };
      throw e;
    }
  }

  private static placeBidTx = maybeTransaction('placeBid', async (client, auctionId: number, bidderId: number, amount: number, allowSelfRebid: boolean) => {
    const state = await client.select({ auctionsEnabled: economy.auctionsEnabled }).from(economy).limit(1).then(r => r[0]!);
    if (!state.auctionsEnabled) throw new AuctionBidError('auctions_disabled');

    // FOR UPDATE - blocks any concurrent bid/cancel/forceClose on this exact auction until we commit
    const auction = await client.select().from(auctions).where(eq(auctions.id, auctionId)).for('update').limit(1).then(a => a?.[0]);
    if (!auction) throw new AuctionBidError('not_found');
    if (auction.status !== 'active') throw new AuctionBidError('not_active');

    const now = new Date();
    if (auction.expiresAt <= now) throw new AuctionBidError('expired');
    if (bidderId === auction.sellerId) throw new AuctionBidError('self_bid');
    // allowSelfRebid: /lance already confirmed "still want to raise your own bid?" - the website's raw bid mutation never sets this, so it still gets the safety block.
    if (auction.currentBidderId !== null && bidderId === auction.currentBidderId && !allowSelfRebid) throw new AuctionBidError('self_rebid');

    if (!Number.isInteger(amount) || amount % auction.bidIncrement !== 0) throw new AuctionBidError('not_a_valid_step');

    const minimum = computeMinimumBid(auction, now);
    if (amount < minimum) throw new AuctionBidError('below_minimum');
    if (amount > auction.capPrice) throw new AuctionBidError('above_cap');

    // debit the new bidder first - if they can't afford it, throw before anything else changes
    const [debited] = await client
      .update(users)
      .set({ coins: sql`${users.coins} - ${amount}` })
      .where(and(eq(users.id, bidderId), gte(users.coins, amount)))
      .returning();
    if (!debited) throw new AuctionBidError('insufficient_coins');

    if (auction.currentBidderId !== null && auction.currentBid !== null) {
      await client.update(users).set({ coins: sql`${users.coins} + ${auction.currentBid}` }).where(eq(users.id, auction.currentBidderId));
    }

    const inOvertime = auction.expiresAt.getTime() - now.getTime() < ANTI_SNIPE_WINDOW_MS;
    const newExpiresAt = inOvertime ? new Date(auction.expiresAt.getTime() + ANTI_SNIPE_EXTENSION_MS) : auction.expiresAt;

    const [updated] = await client
      .update(auctions)
      .set({ currentBid: amount, currentBidderId: bidderId, expiresAt: newExpiresAt })
      .where(eq(auctions.id, auctionId))
      .returning();

    await client.insert(auctionBids).values({ auctionId, bidderId, amount });

    if (amount === auction.capPrice) {
      const settled = await AuctionsDB.settleAuction(client, updated!, 'sold');
      return { auction: settled, settled: true };
    }

    return { auction: updated!, settled: false };
  })

  // shared settlement for placeBid's cap-hit path and the sweep/forceClose below - 'sold' assumes currentBid/currentBidderId are set, 'expired' assumes they aren't.
  private static async settleAuction(client: DrizzleClient, auction: Auction, outcome: 'sold' | 'expired'): Promise<Auction> {
    if (outcome === 'sold') {
      // the bid was already fully debited from the bidder in placeBidTx - withhold the commission from it here, before paying out the seller.
      const state = await client.select({ auctionSaleFeeRate: economy.auctionSaleFeeRate }).from(economy).limit(1).then(r => r[0]!);
      const saleFeePaid = Math.round(auction.currentBid! * state.auctionSaleFeeRate);
      const payout = auction.currentBid! - saleFeePaid;

      await client.update(users).set({ coins: sql`${users.coins} + ${payout}` }).where(eq(users.id, auction.sellerId));
      await EconomyDB.chargeAuctionSaleFee(client, auction.sellerId, saleFeePaid);

      // the winner is a different owner - fresh entry, no copy of the seller's tradable/custom* fields
      await client.insert(userCards).values({ userId: auction.currentBidderId!, cardId: auction.cardId, count: 1 })
        .onConflictDoUpdate({ target: [userCards.userId, userCards.cardId], set: { count: sql`${userCards.count} + 1` } });

      const [updated] = await client.update(auctions).set({ status: 'sold', saleFeePaid, resolvedAt: new Date() }).where(eq(auctions.id, auction.id)).returning();
      return updated!;
    }

    // expired (no bids): return the card to the seller, restoring their original customization
    await client.insert(userCards).values({
      userId: auction.sellerId, cardId: auction.cardId, count: 1,
      tradable: auction.tradable, customEmoji: auction.customEmoji, customMediaUrl: auction.customMediaUrl, customMediaType: auction.customMediaType,
    }).onConflictDoUpdate({
      target: [userCards.userId, userCards.cardId],
      set: {
        count: sql`${userCards.count} + 1`,
        customEmoji: sql`coalesce(${userCards.customEmoji}, excluded."customEmoji")`,
        customMediaUrl: sql`coalesce(${userCards.customMediaUrl}, excluded."customMediaUrl")`,
        customMediaType: sql`coalesce(${userCards.customMediaType}, excluded."customMediaType")`,
      },
    });

    const [updated] = await client.update(auctions).set({ status: 'expired', resolvedAt: new Date() }).where(eq(auctions.id, auction.id)).returning();
    return updated!;
  }

  static sweepExpiredAuctions = async (schedTime: Date) => {
    const candidates = await db.select({ id: auctions.id }).from(auctions).where(and(eq(auctions.status, 'active'), lte(auctions.expiresAt, schedTime)));
    for (const { id } of candidates) await AuctionsDB.settleOneExpired(id, schedTime);
  }

  // re-checks status='active' AND expiresAt<=schedTime under the lock - a candidate from the unlocked SELECT above may since have been resolved by another tick, or extended by a concurrent anti-snipe bid.
  private static settleOneExpired = maybeTransaction('settleOneExpired', async (client, auctionId: number, schedTime: Date) => {
    const auction = await client.select().from(auctions).where(and(eq(auctions.id, auctionId), eq(auctions.status, 'active'))).for('update').limit(1).then(a => a?.[0]);
    if (!auction) return;
    if (auction.expiresAt > schedTime) return; // anti-snipe extension landed while we waited for the lock
    await AuctionsDB.settleAuction(client, auction, auction.currentBid !== null ? 'sold' : 'expired');
  })

  static cancelAuction = async (auctionId: number, requestedBy: number, opts: { asAdmin: boolean }) => {
    try {
      const auction = await AuctionsDB.cancelAuctionTx(auctionId, requestedBy, opts.asAdmin);
      return { ok: true as const, auction };
    } catch (e) {
      if (e instanceof AuctionCancelError) return { ok: false as const, reason: e.reason };
      throw e;
    }
  }

  private static cancelAuctionTx = maybeTransaction('cancelAuction', async (client, auctionId: number, requestedBy: number, asAdmin: boolean) => {
    const auction = await client.select().from(auctions).where(eq(auctions.id, auctionId)).for('update').limit(1).then(a => a?.[0]);
    if (!auction || auction.status !== 'active') throw new AuctionCancelError('not_found');
    if (!asAdmin && auction.sellerId !== requestedBy) throw new AuctionCancelError('not_owner');

    await client.insert(userCards).values({
      userId: auction.sellerId, cardId: auction.cardId, count: 1,
      tradable: auction.tradable, customEmoji: auction.customEmoji, customMediaUrl: auction.customMediaUrl, customMediaType: auction.customMediaType,
    }).onConflictDoUpdate({
      target: [userCards.userId, userCards.cardId],
      set: {
        count: sql`${userCards.count} + 1`,
        customEmoji: sql`coalesce(${userCards.customEmoji}, excluded."customEmoji")`,
        customMediaUrl: sql`coalesce(${userCards.customMediaUrl}, excluded."customMediaUrl")`,
        customMediaType: sql`coalesce(${userCards.customMediaType}, excluded."customMediaType")`,
      },
    });

    // cancelling voids the sale outright, even with a live bid - refund that bidder in full, seller or admin cancel alike.
    if (auction.currentBidderId !== null && auction.currentBid !== null) {
      await client.update(users).set({ coins: sql`${users.coins} + ${auction.currentBid}` }).where(eq(users.id, auction.currentBidderId));
    }

    const [updated] = await client.update(auctions).set({ status: 'cancelled', resolvedAt: new Date() }).where(eq(auctions.id, auctionId)).returning();
    return updated!;
  })

  static forceCloseAuction = async (auctionId: number) => {
    try {
      const auction = await AuctionsDB.forceCloseAuctionTx(auctionId);
      return { ok: true as const, auction };
    } catch (e) {
      if (e instanceof AuctionForceCloseError) return { ok: false as const, reason: e.reason };
      throw e;
    }
  }

  private static forceCloseAuctionTx = maybeTransaction('forceCloseAuction', async (client, auctionId: number) => {
    const auction = await client.select().from(auctions).where(eq(auctions.id, auctionId)).for('update').limit(1).then(a => a?.[0]);
    if (!auction || auction.status !== 'active') throw new AuctionForceCloseError('not_found');
    return await AuctionsDB.settleAuction(client, auction, auction.currentBid !== null ? 'sold' : 'expired');
  })

  // notification outboxes, drained by CronJobs.runAuctionSweep (packages/database has no messaging access).
  // Mark-after-send (not mark-then-send): a crash mid-send re-reads the same unmarked rows on replay instead of losing them.

  // a bid row counts as "outbid" once a later bid from a *different* bidder exists AND it's that bidder's own latest row - the second condition avoids double-notifying a bidder's self-superseded rows after a confirmed self-rebid.
  static listUnnotifiedBids = maybeTransaction('listUnnotifiedBids', async (client, limit = 50) => {
    const result = await client.execute<{ id: number; auctionId: number; bidderId: number; amount: number }>(sql`
      SELECT b.id, b."auctionId", b."bidderId", b."amount" FROM ${auctionBids} b
      WHERE b."notifiedAt" IS NULL
        AND EXISTS (SELECT 1 FROM ${auctionBids} b2 WHERE b2."auctionId" = b."auctionId" AND b2.id > b.id AND b2."bidderId" != b."bidderId")
        AND NOT EXISTS (SELECT 1 FROM ${auctionBids} b3 WHERE b3."auctionId" = b."auctionId" AND b3."bidderId" = b."bidderId" AND b3.id > b.id)
      ORDER BY b.id
      LIMIT ${limit}
    `);
    return result.rows;
  })

  static markBidNotified = maybeTransaction('markBidNotified', async (client, id: number) => {
    await client.update(auctionBids).set({ notifiedAt: sql`now()` }).where(eq(auctionBids.id, id));
  })

  static listUnnotifiedResolutions = maybeTransaction('listUnnotifiedResolutions', async (client, limit = 50) => {
    return await client
      .select()
      .from(auctions)
      .where(and(isNull(auctions.resolutionNotifiedAt), sql`${auctions.status} != 'active'`))
      .orderBy(asc(auctions.id))
      .limit(limit);
  })

  static markResolutionNotified = maybeTransaction('markResolutionNotified', async (client, id: number) => {
    await client.update(auctions).set({ resolutionNotifiedAt: sql`now()` }).where(eq(auctions.id, id));
  })
}
