import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { users } from "../../schemas/users";
import { userCards, auctions, auctionBids, auctionWatches, auctionWatchNotifications, subcategoryCompletionRewards } from "../../schemas/cards";
import { eq, and, inArray, sql } from "drizzle-orm";
import { AuctionsDB, type Auction } from "../../auctions";
import { CardsDB } from "../../cards";
import { EconomyDB } from "../../economy";
import { UsersDB } from "../../users";

async function setCoins(userId: number, amount: number) {
  await db.update(users).set({ coins: amount }).where(eq(users.id, userId));
}

async function getCoins(userId: number): Promise<number> {
  return await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId)).then(r => r[0]!.coins);
}

async function expireNow(auctionId: number) {
  await db.update(auctions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(auctions.id, auctionId));
}

async function getAuctionRow(auctionId: number): Promise<Auction> {
  return await db.select().from(auctions).where(eq(auctions.id, auctionId)).then(r => r[0]!);
}

async function getOwnedCount(userId: number, cardId: number): Promise<number> {
  const row = await db.select({ count: userCards.count }).from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId))).then(r => r[0]);
  return row?.count ?? 0;
}

describe("AuctionsDB", () => {
  const fx = new TestFixtures();
  let rarityId: number;
  let subcategoryId: number;

  beforeAll(async () => {
    const categoryId = (await fx.category({ name: `Test Leilao Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Leilao Subcategory" })).id;
    rarityId = (await fx.rarity({ name: `Test Leilao Rarity ${Date.now()}`, auctionBaseValue: 10000 })).id;
  });

  afterAll(async () => {
    // auctions/auctionBids/auctionWatch* FK rows must go first, or fx.cleanup()'s card/user deletes fail - every test user here is named "Test Leilao ...".
    await db.delete(auctionWatchNotifications).where(sql`"userId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao%')`);
    await db.delete(auctionWatches).where(sql`"userId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao%')`);
    await db.delete(auctionBids).where(sql`"auctionId" IN (SELECT id FROM ${auctions} WHERE "sellerId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao%'))`);
    await db.delete(auctions).where(sql`"sellerId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao%')`);
    await db.delete(subcategoryCompletionRewards).where(eq(subcategoryCompletionRewards.subcategoryId, subcategoryId));
    // settleAuction/cancelAuction insert into userCards outside of fx.ownCard's tracking - sweep those up too before deleting the users/cards.
    await db.delete(userCards).where(sql`"userId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao%')`);
    await fx.cleanup();
  });

  // a fresh, funded seller/card per test/helper call, so tests don't interfere with each other's cooldown/ownership state.
  let sellerCounter = 0;
  async function freshSeller(): Promise<number> {
    sellerCounter++;
    const seller = await fx.user({ displayName: `Test Leilao Seller ${sellerCounter}` });
    await setCoins(seller.id, 1_000_000);
    return seller.id;
  }

  async function freshCard(name: string): Promise<number> {
    const card = await fx.card({ name, rarityId, subcategoryId });
    return card.id;
  }

  async function freshTradableSellerCard(name: string, count: number = 1): Promise<{ sellerId: number; cardId: number }> {
    const sellerId = await freshSeller();
    const cardId = await freshCard(name);
    await fx.ownCard(sellerId, cardId, count);
    await CardsDB.setCardTradable(sellerId, cardId, true);
    return { sellerId, cardId };
  }

  describe("createAuction", () => {
    test("happy path: free to list, removes the card from userCards, snapshots the auction row", async () => {
      const { sellerId, cardId } = await freshTradableSellerCard("Test Leilao Card Happy");

      const state = await EconomyDB.getState();
      const expectedStartingBid = Math.round((10000 * state.inflationRate) / 500) * 500;
      const before = await getCoins(sellerId);

      const result = await AuctionsDB.createAuction(sellerId, cardId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.auction.startingBid).toBe(expectedStartingBid);
      expect(result.auction.capPrice).toBe(expectedStartingBid * 3);
      expect(result.auction.status).toBe('active');
      expect(result.auction.saleFeePaid).toBeNull();

      // creating a listing costs nothing.
      expect(await getCoins(sellerId)).toBe(before);
      expect(await getOwnedCount(sellerId, cardId)).toBe(0);
    });

    test("startingBid/capPrice stay aligned to bidIncrement even at a non-1x inflation rate", async () => {
      // 1.75x reproduces the drift bug: rounding startingBid and bidIncrement to 500 independently used to land them on different multiples (bidIncrement=1000, startingBid=17500).
      const originalState = await EconomyDB.getState();
      const { sellerId, cardId } = await freshTradableSellerCard("Test Leilao Card GridAlign");
      try {
        await EconomyDB.setInflationRate(1.75);

        const created = await AuctionsDB.createAuction(sellerId, cardId);
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        expect(created.auction.startingBid % created.auction.bidIncrement).toBe(0);
        expect(created.auction.capPrice % created.auction.bidIncrement).toBe(0);

        // the real-world manifestation of the bug: bidding exactly the advertised starting bid
        const bidderId = await freshSeller();
        const bid = await AuctionsDB.placeBid(created.auction.id, bidderId, created.auction.startingBid);
        expect(bid.ok).toBe(true);
      } finally {
        await EconomyDB.setInflationRate(originalState.inflationRate);
      }
    });

    test("non-tradable card is rejected", async () => {
      const sellerId = await freshSeller();
      const cardId = await freshCard("Test Leilao Card NotTradable");
      await fx.ownCard(sellerId, cardId, 1); // not marked tradable

      const result = await AuctionsDB.createAuction(sellerId, cardId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('not_owned');
    });

    test("card not owned at all is rejected", async () => {
      const sellerId = await freshSeller();
      const cardId = await freshCard("Test Leilao Card NotOwned");

      const result = await AuctionsDB.createAuction(sellerId, cardId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('not_owned');
    });

    test("rarity without a configured auctionBaseValue is rejected", async () => {
      const unconfiguredRarityId = (await fx.rarity({ name: `Test Leilao Unconfigured ${Date.now()}` })).id; // default auctionBaseValue = 0
      const sellerId = await freshSeller();
      const card = await fx.card({ name: "Test Leilao Card Unconfigured", rarityId: unconfiguredRarityId, subcategoryId });
      await fx.ownCard(sellerId, card.id, 1);
      await CardsDB.setCardTradable(sellerId, card.id, true);

      const result = await AuctionsDB.createAuction(sellerId, card.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('rarity_not_configured');
    });

    test("a second copy of a card already in an active auction hits the partial unique index, not just the stock decrement", async () => {
      const { sellerId, cardId } = await freshTradableSellerCard("Test Leilao Card DoubleList", 2); // owns 2 copies, so a naive stock check alone wouldn't block a second listing

      const first = await AuctionsDB.createAuction(sellerId, cardId);
      expect(first.ok).toBe(true);
      expect(await getOwnedCount(sellerId, cardId)).toBe(1);

      const second = await AuctionsDB.createAuction(sellerId, cardId);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.reason).toBe('already_active');
      // the failed attempt's decrement must have rolled back
      expect(await getOwnedCount(sellerId, cardId)).toBe(1);
    });

    test("daily limit of 3 is enforced per seller", async () => {
      const sellerId = await freshSeller();

      for (let i = 0; i < 3; i++) {
        const cardId = await freshCard(`Test Leilao Card DailyLimit ${i}`);
        await fx.ownCard(sellerId, cardId, 1);
        await CardsDB.setCardTradable(sellerId, cardId, true);
        const result = await AuctionsDB.createAuction(sellerId, cardId);
        expect(result.ok).toBe(true);
      }

      const fourthCardId = await freshCard("Test Leilao Card DailyLimit 4th");
      await fx.ownCard(sellerId, fourthCardId, 1);
      await CardsDB.setCardTradable(sellerId, fourthCardId, true);
      const fourth = await AuctionsDB.createAuction(sellerId, fourthCardId);
      expect(fourth.ok).toBe(false);
      if (fourth.ok) return;
      expect(fourth.reason).toBe('daily_limit');
    });

    test("cooldown blocks re-listing the same card right after an expiry", async () => {
      const { sellerId, cardId } = await freshTradableSellerCard("Test Leilao Card Cooldown");

      const created = await AuctionsDB.createAuction(sellerId, cardId);
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await expireNow(created.auction.id);
      await AuctionsDB.sweepExpiredAuctions(new Date()); // resolves as 'expired', no bids

      const retry = await AuctionsDB.createAuction(sellerId, cardId);
      expect(retry.ok).toBe(false);
      if (retry.ok) return;
      expect(retry.reason).toBe('cooldown');
      // retryAfterMs should read as ~30min (the current RELIST_COOLDOWN_MS), not some stale/zero value
      expect(retry.retryAfterMs).toBeGreaterThan(29 * 60 * 1000);
      expect(retry.retryAfterMs).toBeLessThanOrEqual(30 * 60 * 1000);
    });
  });

  describe("placeBid", () => {
    async function freshAuction(cardName: string): Promise<Auction> {
      const { sellerId, cardId } = await freshTradableSellerCard(cardName);
      const result = await AuctionsDB.createAuction(sellerId, cardId);
      if (!result.ok) throw new Error(`fixture setup failed: ${result.reason}`);
      return result.auction;
    }

    test("happy path: debits the bidder and records the bid", async () => {
      const auction = await freshAuction("Test Leilao Bid Happy");
      const bidderId = await freshSeller();

      const result = await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.auction.currentBid).toBe(auction.startingBid);
      expect(result.auction.currentBidderId).toBe(bidderId);
      expect(await getCoins(bidderId)).toBe(1_000_000 - auction.startingBid);
    });

    test("two people bidding the exact same amount at the exact same time - exactly one wins, no lost update, no double charge", async () => {
      // fires both placeBid calls truly concurrently (separate pooled connections) - placeBidTx's `SELECT ... FOR UPDATE` is what has to make this safe.
      const auction = await freshAuction("Test Leilao Bid Concurrent");
      const bidderA = await freshSeller();
      const bidderB = await freshSeller();
      const beforeA = await getCoins(bidderA);
      const beforeB = await getCoins(bidderB);

      const [resultA, resultB] = await Promise.all([
        AuctionsDB.placeBid(auction.id, bidderA, auction.startingBid),
        AuctionsDB.placeBid(auction.id, bidderB, auction.startingBid),
      ]);

      const winners = [resultA, resultB].filter(r => r.ok);
      const losers = [resultA, resultB].filter(r => !r.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      if (!losers[0]!.ok) expect(losers[0]!.reason).toBe('below_minimum');

      const row = await getAuctionRow(auction.id);
      expect(row.currentBid).toBe(auction.startingBid);
      const winnerIsA = row.currentBidderId === bidderA;
      expect(winnerIsA || row.currentBidderId === bidderB).toBe(true);

      // exactly one of them was actually charged - the loser's balance is untouched
      expect(await getCoins(bidderA)).toBe(winnerIsA ? beforeA - auction.startingBid : beforeA);
      expect(await getCoins(bidderB)).toBe(winnerIsA ? beforeB : beforeB - auction.startingBid);

      const bidRows = await db.select().from(auctionBids).where(eq(auctionBids.auctionId, auction.id));
      expect(bidRows).toHaveLength(1);
    });

    test("getting outbid refunds the previous bidder in full", async () => {
      const auction = await freshAuction("Test Leilao Bid Outbid");
      const bidderA = await freshSeller();
      const bidderB = await freshSeller();

      await AuctionsDB.placeBid(auction.id, bidderA, auction.startingBid);
      expect(await getCoins(bidderA)).toBe(1_000_000 - auction.startingBid);

      const higher = auction.startingBid + auction.bidIncrement;
      const result = await AuctionsDB.placeBid(auction.id, bidderB, higher);
      expect(result.ok).toBe(true);

      expect(await getCoins(bidderA)).toBe(1_000_000); // refunded in full
      expect(await getCoins(bidderB)).toBe(1_000_000 - higher);
    });

    test("below the minimum valid amount is rejected", async () => {
      const auction = await freshAuction("Test Leilao Bid BelowMin");
      const bidderId = await freshSeller();

      const result = await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid - 500);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('below_minimum');
    });

    test("a decimal or off-step amount is rejected as not_a_valid_step", async () => {
      const auction = await freshAuction("Test Leilao Bid Decimal");
      const bidderId = await freshSeller();

      const decimal = await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid + 0.5);
      expect(decimal.ok).toBe(false);
      if (!decimal.ok) expect(decimal.reason).toBe('not_a_valid_step');

      const offStep = await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid + 1);
      expect(offStep.ok).toBe(false);
      if (!offStep.ok) expect(offStep.reason).toBe('not_a_valid_step');

      const row = await getAuctionRow(auction.id);
      expect(row.currentBid).toBeNull();
    });

    test("the seller cannot bid on their own auction", async () => {
      const auction = await freshAuction("Test Leilao Bid SelfBid");
      const result = await AuctionsDB.placeBid(auction.id, auction.sellerId, auction.startingBid);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('self_bid');
    });

    test("the current highest bidder cannot re-bid on themselves", async () => {
      const auction = await freshAuction("Test Leilao Bid SelfRebid");
      const bidderId = await freshSeller();

      await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);
      const result = await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid + auction.bidIncrement);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('self_rebid');
    });

    test("above the cap is rejected, exactly at the cap wins instantly", async () => {
      const auction = await freshAuction("Test Leilao Bid Cap");
      const bidderId = await freshSeller();

      const tooHigh = await AuctionsDB.placeBid(auction.id, bidderId, auction.capPrice + 500);
      expect(tooHigh.ok).toBe(false);
      if (!tooHigh.ok) expect(tooHigh.reason).toBe('above_cap');

      const sellerBefore = await getCoins(auction.sellerId);
      const state = await EconomyDB.getState();
      const atCap = await AuctionsDB.placeBid(auction.id, bidderId, auction.capPrice);
      expect(atCap.ok).toBe(true);
      if (!atCap.ok) return;
      expect(atCap.settled).toBe(true);
      expect(atCap.auction.status).toBe('sold');
      const expectedFee = Math.round(auction.capPrice * state.auctionSaleFeeRate);
      expect(atCap.auction.saleFeePaid).toBe(expectedFee);
      expect(await getCoins(auction.sellerId)).toBe(sellerBefore + auction.capPrice - expectedFee);
      expect(await getOwnedCount(bidderId, auction.cardId)).toBe(1);
    });

    test("insufficient coins leaves the auction untouched", async () => {
      const auction = await freshAuction("Test Leilao Bid Poor");
      const bidderId = await freshSeller();
      await setCoins(bidderId, 0);

      const result = await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('insufficient_coins');
      const row = await getAuctionRow(auction.id);
      expect(row.currentBid).toBeNull();
    });

    test("a bid inside the last 2 minutes extends expiresAt and raises the minimum increment", async () => {
      const auction = await freshAuction("Test Leilao Bid AntiSnipe");
      const bidder1 = await freshSeller();
      const bidder2 = await freshSeller();

      // establish a currentBid first, well before expiry - no overtime rules should apply yet
      await AuctionsDB.placeBid(auction.id, bidder1, auction.startingBid);

      // now simulate the auction being about to end
      const soonExpiry = new Date(Date.now() + 60 * 1000); // 1 min from now - inside the 2min window
      await db.update(auctions).set({ expiresAt: soonExpiry }).where(eq(auctions.id, auction.id));

      // normal bidIncrement is no longer enough once genuinely inside the anti-snipe window
      const tooSmall = await AuctionsDB.placeBid(auction.id, bidder2, auction.startingBid + auction.bidIncrement);
      expect(tooSmall.ok).toBe(false);
      if (!tooSmall.ok) expect(tooSmall.reason).toBe('below_minimum');

      const overtimeValid = await AuctionsDB.placeBid(auction.id, bidder2, auction.startingBid + auction.overtimeIncrement);
      expect(overtimeValid.ok).toBe(true);
      if (!overtimeValid.ok) return;
      expect(overtimeValid.auction.expiresAt.getTime()).toBeGreaterThan(soonExpiry.getTime()); // extended
    });
  });

  describe("sweepExpiredAuctions / settlement", () => {
    async function freshAuction(cardName: string): Promise<Auction> {
      const { sellerId, cardId } = await freshTradableSellerCard(cardName);
      const result = await AuctionsDB.createAuction(sellerId, cardId);
      if (!result.ok) throw new Error(`fixture setup failed: ${result.reason}`);
      return result.auction;
    }

    test("sold: moves the sale price minus the sale fee to the seller, and the card to the winner", async () => {
      const auction = await freshAuction("Test Leilao Sweep Sold");
      const bidderId = await freshSeller();
      await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);

      const state = await EconomyDB.getState();
      const sellerBefore = await getCoins(auction.sellerId);
      await expireNow(auction.id);
      await AuctionsDB.sweepExpiredAuctions(new Date());

      const row = await getAuctionRow(auction.id);
      expect(row.status).toBe('sold');
      const expectedFee = Math.round(auction.startingBid * state.auctionSaleFeeRate);
      expect(row.saleFeePaid).toBe(expectedFee);
      expect(await getCoins(auction.sellerId)).toBe(sellerBefore + auction.startingBid - expectedFee);
      expect(await getOwnedCount(bidderId, auction.cardId)).toBe(1);
    });

    // settleAuction's winner insert used to omit tradable entirely, ignoring the winner's own /autotroca default.
    test("sold: the winner's new copy respects their own /autotroca default, not the seller's", async () => {
      const auction = await freshAuction("Test Leilao Sweep TradableDefault");
      const bidderId = await freshSeller();
      await UsersDB.setMakeCardsTradeableByDefault(bidderId, true);
      await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);

      await expireNow(auction.id);
      await AuctionsDB.sweepExpiredAuctions(new Date());

      expect(await CardsDB.isCardTradable(bidderId, auction.cardId)).toBe(true);
    });

    test("expired without bids: card returns, nothing charged either way (listing was free)", async () => {
      const auction = await freshAuction("Test Leilao Sweep ExpiredNoBids");
      const sellerCoinsBefore = await getCoins(auction.sellerId);

      await expireNow(auction.id);
      await AuctionsDB.sweepExpiredAuctions(new Date());

      const row = await getAuctionRow(auction.id);
      expect(row.status).toBe('expired');
      expect(row.saleFeePaid).toBeNull();
      expect(await getOwnedCount(auction.sellerId, auction.cardId)).toBe(1);
      expect(await getCoins(auction.sellerId)).toBe(sellerCoinsBefore);
    });

    test("a second sweep call is a safe no-op for an already-resolved auction", async () => {
      const auction = await freshAuction("Test Leilao Sweep Idempotent");
      await expireNow(auction.id);
      await AuctionsDB.sweepExpiredAuctions(new Date());
      const afterFirst = await getAuctionRow(auction.id);

      await AuctionsDB.sweepExpiredAuctions(new Date()); // should find nothing to do - status is no longer 'active'
      const afterSecond = await getAuctionRow(auction.id);
      expect(afterSecond.resolvedAt?.getTime()).toBe(afterFirst.resolvedAt?.getTime());
    });

    // real race: an anti-snipe bid can extend expiresAt after sweepExpiredAuctions' unlocked candidate SELECT already read it but before settleOneExpired gets the row lock. Run several times since the harmful interleaving isn't guaranteed on every attempt.
    test("an anti-snipe bid racing the sweep is never settled out from under its own extension", async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const auction = await freshAuction(`Test Leilao Sweep AntiSnipeRace ${attempt}`);
        const bidderId = await freshSeller();

        // inside the anti-snipe window, so a bid landing now extends expiresAt by 2min
        const originalExpiresAt = new Date(Date.now() + 5 * 1000);
        await db.update(auctions).set({ expiresAt: originalExpiresAt }).where(eq(auctions.id, auction.id));

        const [bidResult] = await Promise.all([
          AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid),
          AuctionsDB.sweepExpiredAuctions(originalExpiresAt),
        ]);

        const row = await getAuctionRow(auction.id);
        if (bidResult.ok) {
          // an extension that actually landed must survive - never settled by a sweep pass that only knew about the pre-extension expiresAt.
          expect(row.status).toBe('active');
          expect(row.expiresAt.getTime()).toBeGreaterThan(originalExpiresAt.getTime());
        } else {
          // the sweep won the race and settled it first - a legitimate last-instant outcome, not a bug.
          expect(bidResult.reason).toBe('not_active');
          expect(row.status).toBe('expired');
        }
      }
    });
  });

  describe("cancelAuction", () => {
    async function freshAuction(cardName: string): Promise<Auction> {
      const { sellerId, cardId } = await freshTradableSellerCard(cardName);
      const result = await AuctionsDB.createAuction(sellerId, cardId);
      if (!result.ok) throw new Error(`fixture setup failed: ${result.reason}`);
      return result.auction;
    }

    test("seller can cancel before any bids - nothing was paid to list, so nothing to refund", async () => {
      const auction = await freshAuction("Test Leilao Cancel NoBids");
      const before = await getCoins(auction.sellerId);

      const result = await AuctionsDB.cancelAuction(auction.id, auction.sellerId, { asAdmin: false });
      expect(result.ok).toBe(true);
      expect(await getOwnedCount(auction.sellerId, auction.cardId)).toBe(1);
      expect(await getCoins(auction.sellerId)).toBe(before);
    });

    test("seller can cancel even with a live bid - the current bidder is refunded in full", async () => {
      const auction = await freshAuction("Test Leilao Cancel HasBids");
      const bidderId = await freshSeller();
      await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);
      const bidderBefore = await getCoins(bidderId); // already debited the bid amount

      const result = await AuctionsDB.cancelAuction(auction.id, auction.sellerId, { asAdmin: false });
      expect(result.ok).toBe(true);
      expect(await getCoins(bidderId)).toBe(bidderBefore + auction.startingBid);
      expect(await getOwnedCount(auction.sellerId, auction.cardId)).toBe(1);
    });

    test("a non-owner cannot cancel", async () => {
      const auction = await freshAuction("Test Leilao Cancel NotOwner");
      const strangerId = await freshSeller();

      const result = await AuctionsDB.cancelAuction(auction.id, strangerId, { asAdmin: false });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('not_owner');
    });

    test("admin can cancel even with a live bid - bidder refunded in full, seller unaffected", async () => {
      const auction = await freshAuction("Test Leilao Cancel Admin");
      const bidderId = await freshSeller();
      await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);

      const bidderBefore = await getCoins(bidderId); // already debited the bid amount
      const sellerBefore = await getCoins(auction.sellerId);

      const result = await AuctionsDB.cancelAuction(auction.id, 999999, { asAdmin: true });
      expect(result.ok).toBe(true);
      expect(await getCoins(bidderId)).toBe(bidderBefore + auction.startingBid);
      expect(await getCoins(auction.sellerId)).toBe(sellerBefore);
      expect(await getOwnedCount(auction.sellerId, auction.cardId)).toBe(1);
    });
  });

  describe("forceCloseAuction", () => {
    async function freshAuction(cardName: string): Promise<Auction> {
      const { sellerId, cardId } = await freshTradableSellerCard(cardName);
      const result = await AuctionsDB.createAuction(sellerId, cardId);
      if (!result.ok) throw new Error(`fixture setup failed: ${result.reason}`);
      return result.auction;
    }

    test("with a live bid, sells immediately at the current bid", async () => {
      const auction = await freshAuction("Test Leilao ForceClose Sold");
      const bidderId = await freshSeller();
      await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);

      const result = await AuctionsDB.forceCloseAuction(auction.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.auction.status).toBe('sold');
    });

    test("with no bids, resolves as an ordinary expiry", async () => {
      const auction = await freshAuction("Test Leilao ForceClose Expired");
      const result = await AuctionsDB.forceCloseAuction(auction.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.auction.status).toBe('expired');
      expect(await getOwnedCount(auction.sellerId, auction.cardId)).toBe(1);
    });
  });

  describe("auctionsEnabled kill-switch", () => {
    test("blocks new listings and bids, but not resolving existing ones", async () => {
      const { sellerId, cardId } = await freshTradableSellerCard("Test Leilao KillSwitch");
      const created = await AuctionsDB.createAuction(sellerId, cardId);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const bidderId = await freshSeller();

      await EconomyDB.setAuctionsEnabled(false);
      try {
        const blockedBid = await AuctionsDB.placeBid(created.auction.id, bidderId, created.auction.startingBid);
        expect(blockedBid.ok).toBe(false);
        if (!blockedBid.ok) expect(blockedBid.reason).toBe('auctions_disabled');

        const otherCardId = await freshCard("Test Leilao KillSwitch Other");
        await fx.ownCard(sellerId, otherCardId, 1);
        await CardsDB.setCardTradable(sellerId, otherCardId, true);
        const blockedCreate = await AuctionsDB.createAuction(sellerId, otherCardId);
        expect(blockedCreate.ok).toBe(false);
        if (!blockedCreate.ok) expect(blockedCreate.reason).toBe('auctions_disabled');

        // still resolvable even while disabled - a reserved bidder shouldn't be stuck forever
        const forceClosed = await AuctionsDB.forceCloseAuction(created.auction.id);
        expect(forceClosed.ok).toBe(true);
      } finally {
        await EconomyDB.setAuctionsEnabled(true);
      }
    });
  });

  describe("notification outboxes", () => {
    async function freshAuction(cardName: string): Promise<Auction> {
      const { sellerId, cardId } = await freshTradableSellerCard(cardName);
      const result = await AuctionsDB.createAuction(sellerId, cardId);
      if (!result.ok) throw new Error(`fixture setup failed: ${result.reason}`);
      return result.auction;
    }

    test("listUnnotifiedBids only returns bids that were later superseded, once each, until marked notified", async () => {
      const auction = await freshAuction("Test Leilao Outbox Outbid");
      const bidderA = await freshSeller();
      const bidderB = await freshSeller();

      await AuctionsDB.placeBid(auction.id, bidderA, auction.startingBid);
      await AuctionsDB.placeBid(auction.id, bidderB, auction.startingBid + auction.bidIncrement);

      const pending = await AuctionsDB.listUnnotifiedBids(100);
      const forThisAuction = pending.filter(c => c.auctionId === auction.id);
      expect(forThisAuction).toHaveLength(1);
      expect(forThisAuction[0]!.bidderId).toBe(bidderA); // B is still current, not outbid

      // not marked yet - still shows up (mark-after-send, not claim-then-send)
      const stillPending = await AuctionsDB.listUnnotifiedBids(100);
      expect(stillPending.filter(c => c.auctionId === auction.id)).toHaveLength(1);

      await AuctionsDB.markBidNotified(forThisAuction[0]!.id);
      const afterMarking = await AuctionsDB.listUnnotifiedBids(100);
      expect(afterMarking.filter(c => c.auctionId === auction.id)).toHaveLength(0);
    });

    test("a confirmed self-rebid doesn't notify the bidder as outbid by themselves, and later being genuinely outbid notifies once, not twice", async () => {
      const auction = await freshAuction("Test Leilao Outbox SelfRebid");
      const bidderA = await freshSeller();
      const bidderB = await freshSeller();

      await AuctionsDB.placeBid(auction.id, bidderA, auction.startingBid);
      // self-rebid, same shape /lance uses after the "confirmar lance maior" prompt
      await AuctionsDB.placeBid(auction.id, bidderA, auction.startingBid + auction.bidIncrement, { allowSelfRebid: true });

      // A's own rebid superseding their own earlier bid shouldn't queue a notification
      const afterSelfRebid = await AuctionsDB.listUnnotifiedBids(100);
      expect(afterSelfRebid.filter(c => c.auctionId === auction.id)).toHaveLength(0);

      await AuctionsDB.placeBid(auction.id, bidderB, auction.startingBid + auction.bidIncrement * 2);

      // now A is genuinely outbid by B - exactly one notification, not one per historical A row
      const afterRealOutbid = await AuctionsDB.listUnnotifiedBids(100);
      const forThisAuction = afterRealOutbid.filter(c => c.auctionId === auction.id);
      expect(forThisAuction).toHaveLength(1);
      expect(forThisAuction[0]!.bidderId).toBe(bidderA);
      expect(forThisAuction[0]!.amount).toBe(auction.startingBid + auction.bidIncrement);
    });

    test("listUnnotifiedResolutions returns a resolved auction until marked notified", async () => {
      const auction = await freshAuction("Test Leilao Outbox Resolution");
      await AuctionsDB.forceCloseAuction(auction.id);

      const pending = await AuctionsDB.listUnnotifiedResolutions(100);
      expect(pending.some(a => a.id === auction.id)).toBe(true);

      await AuctionsDB.markResolutionNotified(auction.id);
      const afterMarking = await AuctionsDB.listUnnotifiedResolutions(100);
      expect(afterMarking.some(a => a.id === auction.id)).toBe(false);
    });
  });

  describe("watches (/leilao wish)", () => {
    test("addWatch/isWatchingCard/removeWatch round-trip, and addWatch is idempotent", async () => {
      const watcherId = await freshSeller();
      const cardId = await freshCard("Test Leilao Watch Toggle");

      expect(await AuctionsDB.isWatchingCard(watcherId, cardId)).toBe(false);

      await AuctionsDB.addWatch(watcherId, cardId);
      expect(await AuctionsDB.isWatchingCard(watcherId, cardId)).toBe(true);

      // re-adding an existing watch must not throw (onConflictDoNothing)
      await AuctionsDB.addWatch(watcherId, cardId);
      expect(await AuctionsDB.isWatchingCard(watcherId, cardId)).toBe(true);

      await AuctionsDB.removeWatch(watcherId, cardId);
      expect(await AuctionsDB.isWatchingCard(watcherId, cardId)).toBe(false);
    });

    test("getActiveAuctionsForCard finds every listing across sellers, not just one", async () => {
      const { sellerId, cardId } = await freshTradableSellerCard("Test Leilao Watch ActiveLookup");
      expect(await AuctionsDB.getActiveAuctionsForCard(cardId)).toHaveLength(0);

      const first = await AuctionsDB.createAuction(sellerId, cardId);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect((await AuctionsDB.getActiveAuctionsForCard(cardId)).map(a => a.id)).toEqual([first.auction.id]);

      // a second, independent owner lists the same cardId - both listings must show up.
      const otherSellerId = await freshSeller();
      await fx.ownCard(otherSellerId, cardId, 1);
      await CardsDB.setCardTradable(otherSellerId, cardId, true);
      const second = await AuctionsDB.createAuction(otherSellerId, cardId);
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const both = await AuctionsDB.getActiveAuctionsForCard(cardId);
      expect(both.map(a => a.id).sort()).toEqual([first.auction.id, second.auction.id].sort());
    });

    test("createAuction queues exactly one alert per watcher, excludes the seller's own watch, and leaves non-watchers untouched", async () => {
      const cardId = await freshCard("Test Leilao Watch Outbox");
      const sellerId = await freshSeller();
      await fx.ownCard(sellerId, cardId, 1);
      await CardsDB.setCardTradable(sellerId, cardId, true);

      const watcherA = await freshSeller();
      const watcherB = await freshSeller();
      const nonWatcher = await freshSeller();
      await AuctionsDB.addWatch(watcherA, cardId);
      await AuctionsDB.addWatch(watcherB, cardId);
      // the seller watching their own card must never generate a self-notification
      await AuctionsDB.addWatch(sellerId, cardId);

      const created = await AuctionsDB.createAuction(sellerId, cardId);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const pending = await AuctionsDB.listUnnotifiedWatchAlerts(500);
      const forThisAuction = pending.filter(a => a.auctionId === created.auction.id);
      const watcherIds = forThisAuction.map(a => a.userId).sort();
      expect(watcherIds).toEqual([watcherA, watcherB].sort());
      expect(forThisAuction.some(a => a.userId === sellerId)).toBe(false);
      expect(forThisAuction.some(a => a.userId === nonWatcher)).toBe(false);

      await AuctionsDB.markWatchAlertNotified(forThisAuction.find(a => a.userId === watcherA)!.id);
      const afterMarkingOne = await AuctionsDB.listUnnotifiedWatchAlerts(500);
      const remaining = afterMarkingOne.filter(a => a.auctionId === created.auction.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.userId).toBe(watcherB);
    });

    test("relisting the same watched card after it expires queues a fresh alert each time", async () => {
      const { sellerId, cardId } = await freshTradableSellerCard("Test Leilao Watch Relist", 2);
      const watcherId = await freshSeller();
      await AuctionsDB.addWatch(watcherId, cardId);

      const first = await AuctionsDB.createAuction(sellerId, cardId);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const firstPending = (await AuctionsDB.listUnnotifiedWatchAlerts(500)).filter(a => a.auctionId === first.auction.id);
      expect(firstPending).toHaveLength(1);
      await AuctionsDB.markWatchAlertNotified(firstPending[0]!.id);

      await expireNow(first.auction.id);
      await AuctionsDB.sweepExpiredAuctions(new Date());
      // clear the relist cooldown so the fixture can list a second copy right away
      await db.update(auctions).set({ resolvedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(auctions.id, first.auction.id));

      const second = await AuctionsDB.createAuction(sellerId, cardId);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const secondPending = (await AuctionsDB.listUnnotifiedWatchAlerts(500)).filter(a => a.auctionId === second.auction.id);
      expect(secondPending).toHaveLength(1);
      expect(secondPending[0]!.userId).toBe(watcherId);
    });
  });

  describe("search", () => {
    test("listActiveAuctions and listActiveAuctionsByCategory match by subcategory name too, like ColecoesTab", async () => {
      const marker = `TestLeilaoSearchMarker${Date.now()}`;
      const categoryId = (await fx.category({ name: `Test Leilao Search Category ${marker}` })).id;
      const searchedSubcategoryId = (await fx.subcategory({ categoryId, name: `${marker} Red Velvet` })).id;
      const otherSubcategoryId = (await fx.subcategory({ categoryId, name: `Test Leilao Search Other ${marker}` })).id;

      const cardInSearchedSub = await fx.card({ name: `Test Leilao Search Irene ${marker}`, rarityId, subcategoryId: searchedSubcategoryId });
      const cardElsewhere = await fx.card({ name: `Test Leilao Search Unrelated ${marker}`, rarityId, subcategoryId: otherSubcategoryId });

      const sellerA = await freshSeller();
      await fx.ownCard(sellerA, cardInSearchedSub.id, 1);
      await CardsDB.setCardTradable(sellerA, cardInSearchedSub.id, true);
      const matching = await AuctionsDB.createAuction(sellerA, cardInSearchedSub.id);
      expect(matching.ok).toBe(true);
      if (!matching.ok) return;

      const sellerB = await freshSeller();
      await fx.ownCard(sellerB, cardElsewhere.id, 1);
      await CardsDB.setCardTradable(sellerB, cardElsewhere.id, true);
      const nonMatching = await AuctionsDB.createAuction(sellerB, cardElsewhere.id);
      expect(nonMatching.ok).toBe(true);
      if (!nonMatching.ok) return;

      // each subcategory has exactly one card, so granting it completes the collection and awards a subcategoryCompletionRewards row - cleaned up before the user rows or fx.cleanup() fails on that FK.
      fx.onCleanup(async () => {
        await db.delete(subcategoryCompletionRewards).where(inArray(subcategoryCompletionRewards.subcategoryId, [searchedSubcategoryId, otherSubcategoryId]));
      });

      // searching "Red Velvet" (the subcategory's name) surfaces the card auctioned from it,
      // even though the card's own name ("Irene") doesn't contain the query
      const flatResult = await AuctionsDB.listActiveAuctions({ query: `${marker} Red Velvet` });
      expect(flatResult.rows.some(r => r.auction.id === matching.auction.id)).toBe(true);
      expect(flatResult.rows.some(r => r.auction.id === nonMatching.auction.id)).toBe(false);

      const byCategoryResult = await AuctionsDB.listActiveAuctionsByCategory({ query: `${marker} Red Velvet` });
      const categoryRow = byCategoryResult.rows.find(r => r.categoryId === categoryId);
      expect(categoryRow).toBeDefined();
      expect(categoryRow!.auctions.some(r => r.auction.id === matching.auction.id)).toBe(true);
      expect(categoryRow!.auctions.some(r => r.auction.id === nonMatching.auction.id)).toBe(false);
    });

    test("listActiveAuctions and listActiveAuctionsByCategory match a purely-numeric query against the card's id", async () => {
      const { sellerId, cardId } = await freshTradableSellerCard("Test Leilao Search ById");
      const created = await AuctionsDB.createAuction(sellerId, cardId);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const flatResult = await AuctionsDB.listActiveAuctions({ query: String(cardId) });
      expect(flatResult.rows.some(r => r.auction.id === created.auction.id)).toBe(true);

      const byCategoryResult = await AuctionsDB.listActiveAuctionsByCategory({ query: String(cardId) });
      const found = byCategoryResult.rows.flatMap(r => r.auctions).some(r => r.auction.id === created.auction.id);
      expect(found).toBe(true);

      // a numeric query that doesn't match any real card id (and isn't a name/subcategory
      // substring either) must not accidentally match everything
      const noMatch = await AuctionsDB.listActiveAuctions({ query: "999999999" });
      expect(noMatch.rows.some(r => r.auction.id === created.auction.id)).toBe(false);
    });
  });
});
