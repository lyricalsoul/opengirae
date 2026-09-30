import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { userCards, auctions, auctionBids, auctionWatches, auctionWatchNotifications, subcategoryCompletionRewards } from "@girae/database/schemas/cards";
import { eq, and, sql } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import { AuctionsDB, type Auction } from "@girae/database/auctions";
import { buildFilterArg } from "@girae/common/utilities/pageFilters";
import LeilaoCommand from "../../commands/cards/leilao";

mockTelegram();

async function setCoins(userId: number, amount: number) {
  await db.update(users).set({ coins: amount }).where(eq(users.id, userId));
}

async function getCoins(userId: number): Promise<number> {
  return await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId)).then(r => r[0]!.coins);
}

async function ownedCount(userId: number, cardId: number): Promise<number> {
  const row = await db.select({ count: userCards.count }).from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId))).then(r => r[0]);
  return row?.count ?? 0;
}

describe("/leilao", () => {
  const fx = new TestFixtures();
  let rarityId: number;
  let subcategoryId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    const categoryId = (await fx.category({ name: `Test Leilao Cmd Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Leilao Cmd Subcategory" })).id;
    rarityId = (await fx.rarity({ name: `Test Leilao Cmd Rarity ${Date.now()}`, auctionBaseValue: 10000 })).id;
  });

  afterAll(async () => {
    await db.delete(auctionWatchNotifications).where(sql`"userId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao Cmd%')`);
    await db.delete(auctionWatches).where(sql`"userId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao Cmd%')`);
    await db.delete(auctionBids).where(sql`"auctionId" IN (SELECT id FROM ${auctions} WHERE "sellerId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao Cmd%'))`);
    await db.delete(auctions).where(sql`"sellerId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao Cmd%')`);
    await db.delete(subcategoryCompletionRewards).where(eq(subcategoryCompletionRewards.subcategoryId, subcategoryId));
    await db.delete(userCards).where(sql`"userId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao Cmd%')`);
    await fx.cleanup();
  });

  // fresh seller per auction, or the daily-limit check (3/day/seller) trips across these tests.
  async function freshAuction(cardName: string): Promise<Auction> {
    const creatorId = (await fx.user({ displayName: `Test Leilao Cmd Auction Seller ${Bun.randomUUIDv7()}` })).id;
    await setCoins(creatorId, 1_000_000);
    const cardId = (await fx.card({ name: cardName, rarityId, subcategoryId })).id;
    await fx.ownCard(creatorId, cardId, 1);
    await CardsDB.setCardTradable(creatorId, cardId, true);
    const result = await AuctionsDB.createAuction(creatorId, cardId);
    if (!result.ok) throw new Error(`fixture setup failed: ${result.reason}`);
    return result.auction;
  }

  async function run(workflowID: string, ctx: ReturnType<typeof fakeCtx>, rest: string) {
    return DBOS.startWorkflow(LeilaoCommand, { workflowID }).execute(ctx, { rest });
  }

  describe("criar", () => {
    test("confirming publishes the auction for free and takes the card out of the seller's collection", async () => {
      const platformId = 'test-leilao-cmd-create';
      const creatorId = (await fx.user({ displayName: "Test Leilao Cmd Create Seller", platform: 'telegram', platformId })).id;
      const cardId = (await fx.card({ name: "Test Leilao Cmd Create Card", rarityId, subcategoryId })).id;
      await fx.ownCard(creatorId, cardId, 1);
      await CardsDB.setCardTradable(creatorId, cardId, true);
      await setCoins(creatorId, 1_000_000);

      const workflowID = `test-leilao-create-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['criar', String(cardId)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `criar ${cardId}`);

      await new Promise(r => setTimeout(r, 500)); // let it reach DBOS.recv and register the listener
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      await handle.getResult();

      expect(await ownedCount(creatorId, cardId)).toBe(0);
      expect(await getCoins(creatorId)).toBe(1_000_000);
      const [auction] = await db.select().from(auctions).where(eq(auctions.sellerId, creatorId));
      expect(auction?.cardId).toBe(cardId);
      expect(auction?.status).toBe('active');
    });

    test("confirming a card that's not actually owned/tradable creates no auction", async () => {
      const platformId = 'test-leilao-cmd-notowned';
      const creatorId = (await fx.user({ displayName: "Test Leilao Cmd NotOwned Seller", platform: 'telegram', platformId })).id;
      const cardId = (await fx.card({ name: "Test Leilao Cmd NotOwned Card", rarityId, subcategoryId })).id;
      await setCoins(creatorId, 1_000_000);
      // deliberately never gives the seller this card

      const workflowID = `test-leilao-notowned-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['criar', String(cardId)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `criar ${cardId}`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      await handle.getResult();

      const created = await db.select().from(auctions).where(eq(auctions.sellerId, creatorId));
      expect(created).toHaveLength(0);
    });
  });

  describe("cancelar", () => {
    test("with an ID: confirming voids the auction and returns the card, only for its own seller", async () => {
      const platformId = 'test-leilao-cmd-cancel';
      const creatorId = (await fx.user({ displayName: "Test Leilao Cmd Cancel Seller", platform: 'telegram', platformId })).id;
      const cardId = (await fx.card({ name: "Test Leilao Cmd Cancel Card", rarityId, subcategoryId })).id;
      await fx.ownCard(creatorId, cardId, 1);
      await CardsDB.setCardTradable(creatorId, cardId, true);
      await setCoins(creatorId, 1_000_000);
      const created = await AuctionsDB.createAuction(creatorId, cardId);
      if (!created.ok) throw new Error('fixture setup failed');

      const otherPlatformId = 'test-leilao-cmd-cancel-stranger';
      await fx.user({ displayName: "Test Leilao Cmd Cancel Stranger", platform: 'telegram', platformId: otherPlatformId });

      const strangerWorkflowID = `test-leilao-cancel-stranger-${Bun.randomUUIDv7()}`;
      const strangerCtx = fakeCtx({ name: 'leilao', authorId: otherPlatformId, args: ['cancelar', String(created.auction.id)], platform: 'telegram', workflowID: strangerWorkflowID });
      await run(strangerWorkflowID, strangerCtx, `cancelar ${created.auction.id}`).then(h => h.getResult());
      expect((await db.select().from(auctions).where(eq(auctions.id, created.auction.id)))[0]?.status).toBe('active'); // untouched - not the owner, never reaches the confirm step

      const workflowID = `test-leilao-cancel-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['cancelar', String(created.auction.id)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `cancelar ${created.auction.id}`);
      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      await handle.getResult();

      expect((await db.select().from(auctions).where(eq(auctions.id, created.auction.id)))[0]?.status).toBe('cancelled');
      expect(await ownedCount(creatorId, cardId)).toBe(1);
    });

    test("without an ID: 0 active auctions replies without touching anything", async () => {
      const platformId = 'test-leilao-cmd-cancel-noid-zero';
      await fx.user({ displayName: "Test Leilao Cmd CancelNoId Zero", platform: 'telegram', platformId });

      const workflowID = `test-leilao-cancel-noid-zero-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['cancelar'], platform: 'telegram', workflowID });
      // no active auction -> replies immediately, never reaches DBOS.recv
      await run(workflowID, ctx, 'cancelar').then(h => h.getResult());
    });

    test("without an ID: exactly 1 active auction cancels it directly after confirming", async () => {
      const platformId = 'test-leilao-cmd-cancel-noid-one';
      const creatorId = (await fx.user({ displayName: "Test Leilao Cmd CancelNoId One", platform: 'telegram', platformId })).id;
      const cardId = (await fx.card({ name: "Test Leilao Cmd CancelNoId One Card", rarityId, subcategoryId })).id;
      await fx.ownCard(creatorId, cardId, 1);
      await CardsDB.setCardTradable(creatorId, cardId, true);
      await setCoins(creatorId, 1_000_000);
      const created = await AuctionsDB.createAuction(creatorId, cardId);
      if (!created.ok) throw new Error('fixture setup failed');

      const workflowID = `test-leilao-cancel-noid-one-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['cancelar'], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, 'cancelar');
      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      await handle.getResult();

      expect((await db.select().from(auctions).where(eq(auctions.id, created.auction.id)))[0]?.status).toBe('cancelled');
    });

    test("without an ID: 2+ active auctions lists them and cancels nothing", async () => {
      const platformId = 'test-leilao-cmd-cancel-noid-many';
      const creatorId = (await fx.user({ displayName: "Test Leilao Cmd CancelNoId Many", platform: 'telegram', platformId })).id;
      const cardAId = (await fx.card({ name: "Test Leilao Cmd CancelNoId Many Card A", rarityId, subcategoryId })).id;
      const cardBId = (await fx.card({ name: "Test Leilao Cmd CancelNoId Many Card B", rarityId, subcategoryId })).id;
      await fx.ownCard(creatorId, cardAId, 1);
      await fx.ownCard(creatorId, cardBId, 1);
      await CardsDB.setCardTradable(creatorId, cardAId, true);
      await CardsDB.setCardTradable(creatorId, cardBId, true);
      await setCoins(creatorId, 1_000_000);
      const createdA = await AuctionsDB.createAuction(creatorId, cardAId);
      const createdB = await AuctionsDB.createAuction(creatorId, cardBId);
      if (!createdA.ok || !createdB.ok) throw new Error('fixture setup failed');

      const workflowID = `test-leilao-cancel-noid-many-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['cancelar'], platform: 'telegram', workflowID });
      // ambiguous - replies with the list, never reaches DBOS.recv
      await run(workflowID, ctx, 'cancelar').then(h => h.getResult());

      expect((await db.select().from(auctions).where(eq(auctions.id, createdA.auction.id)))[0]?.status).toBe('active');
      expect((await db.select().from(auctions).where(eq(auctions.id, createdB.auction.id)))[0]?.status).toBe('active');
    });
  });

  describe("lance", () => {
    test("a valid bid debits the bidder and registers as the current bid", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card Happy");
      const platformId = 'test-leilao-cmd-lance-happy';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder Happy", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const workflowID = `test-leilao-lance-happy-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(auction.startingBid)], platform: 'telegram', workflowID });
      await run(workflowID, ctx, `lance ${auction.id} ${auction.startingBid}`).then(h => h.getResult());

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBe(auction.startingBid);
      expect(row?.currentBidderId).toBe(bidderId);
      expect(await getCoins(bidderId)).toBe(1_000_000 - auction.startingBid);
    });

    test("omitting the amount (button click) asks for confirmation before placing the minimum bid", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card Default");
      const platformId = 'test-leilao-cmd-lance-default';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder Default", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const workflowID = `test-leilao-lance-default-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id}`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      await handle.getResult();

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBe(auction.startingBid);
    });

    test("omitting the amount (button click); declining the confirmation leaves the auction untouched", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card Default Decline");
      const platformId = 'test-leilao-cmd-lance-default-decline';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder Default Decline", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const workflowID = `test-leilao-lance-default-decline-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id}`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: false }, 'leilao:confirm');
      await handle.getResult();

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBeNull();
    });

    test("a below-minimum amount offers the minimum bid; declining leaves the auction untouched", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card Low");
      const platformId = 'test-leilao-cmd-lance-low';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder Low", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const workflowID = `test-leilao-lance-low-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(auction.startingBid - 500)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id} ${auction.startingBid - 500}`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: false }, 'leilao:confirm');
      await handle.getResult();

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBeNull();
      expect(await getCoins(bidderId)).toBe(1_000_000);
    });

    test("accepting the minimum-bid offer places the bid at the minimum", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card LowAccept");
      const platformId = 'test-leilao-cmd-lance-lowaccept';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder LowAccept", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const workflowID = `test-leilao-lance-lowaccept-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(auction.startingBid - 500)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id} ${auction.startingBid - 500}`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      await handle.getResult();

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBe(auction.startingBid);
    });

    test("the seller bidding on their own auction is rejected outright, no confirmation shown", async () => {
      const platformId = 'test-leilao-cmd-lance-selfbid-seller';
      const ownSellerId = (await fx.user({ displayName: "Test Leilao Cmd SelfBid Seller", platform: 'telegram', platformId })).id;
      const cardId = (await fx.card({ name: "Test Leilao Cmd Card SelfBid", rarityId, subcategoryId })).id;
      await fx.ownCard(ownSellerId, cardId, 1);
      await CardsDB.setCardTradable(ownSellerId, cardId, true);
      await setCoins(ownSellerId, 1_000_000);
      const created = await AuctionsDB.createAuction(ownSellerId, cardId);
      if (!created.ok) throw new Error('fixture setup failed');

      const workflowID = `test-leilao-lance-selfbid-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(created.auction.id), String(created.auction.startingBid)], platform: 'telegram', workflowID });
      await run(workflowID, ctx, `lance ${created.auction.id} ${created.auction.startingBid}`).then(h => h.getResult());

      const row = await db.select().from(auctions).where(eq(auctions.id, created.auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBeNull();
    });

    test("a decimal amount offers the minimum bid; declining leaves the auction untouched", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card Decimal");
      const platformId = 'test-leilao-cmd-lance-decimal';
      await fx.user({ displayName: "Test Leilao Cmd Bidder Decimal", platform: 'telegram', platformId });

      const workflowID = `test-leilao-lance-decimal-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), `${auction.startingBid}.5`], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id} ${auction.startingBid}.5`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: false }, 'leilao:confirm');
      await handle.getResult();

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBeNull();
    });

    test("rebidding as the current top bidder asks for confirmation; accepting raises the bid", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card SelfRebid");
      const platformId = 'test-leilao-cmd-lance-selfrebid';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder SelfRebid", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const firstWorkflowID = `test-leilao-lance-selfrebid-first-${Bun.randomUUIDv7()}`;
      const firstCtx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(auction.startingBid)], platform: 'telegram', workflowID: firstWorkflowID });
      await run(firstWorkflowID, firstCtx, `lance ${auction.id} ${auction.startingBid}`).then(h => h.getResult());

      const higher = auction.startingBid + auction.bidIncrement;
      const workflowID = `test-leilao-lance-selfrebid-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(higher)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id} ${higher}`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      await handle.getResult();

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBe(higher);
      expect(await getCoins(bidderId)).toBe(1_000_000 - higher);
    });

    test("rebidding as the current top bidder, declining the confirmation leaves the bid unchanged", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card SelfRebidDecline");
      const platformId = 'test-leilao-cmd-lance-selfrebid-decline';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder SelfRebidDecline", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const firstWorkflowID = `test-leilao-lance-selfrebid-decline-first-${Bun.randomUUIDv7()}`;
      const firstCtx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(auction.startingBid)], platform: 'telegram', workflowID: firstWorkflowID });
      await run(firstWorkflowID, firstCtx, `lance ${auction.id} ${auction.startingBid}`).then(h => h.getResult());

      const higher = auction.startingBid + auction.bidIncrement;
      const workflowID = `test-leilao-lance-selfrebid-decline-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(higher)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id} ${higher}`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: false }, 'leilao:confirm');
      await handle.getResult();

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBe(auction.startingBid);
      expect(await getCoins(bidderId)).toBe(1_000_000 - auction.startingBid);
    });

    test("as the current top bidder, an invalid amount asks to fix the value first, then confirms the self-rebid - not the other way round", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card SelfRebidInvalid");
      const platformId = 'test-leilao-cmd-lance-selfrebid-invalid';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder SelfRebidInvalid", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const firstWorkflowID = `test-leilao-lance-selfrebid-invalid-first-${Bun.randomUUIDv7()}`;
      const firstCtx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(auction.startingBid)], platform: 'telegram', workflowID: firstWorkflowID });
      await run(firstWorkflowID, firstCtx, `lance ${auction.id} ${auction.startingBid}`).then(h => h.getResult());

      // below the new minimum (startingBid + bidIncrement) - invalid, not just "not higher"
      const tooLow = auction.startingBid - 500;
      const workflowID = `test-leilao-lance-selfrebid-invalid-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(tooLow)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id} ${tooLow}`);

      // first prompt must be "invalid value, use the minimum?" - confirm it
      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      // second prompt is now "you're already winning, still want to pay more (the corrected minimum)?"
      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      await handle.getResult();

      const minimum = auction.startingBid + auction.bidIncrement;
      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBe(minimum);
      expect(await getCoins(bidderId)).toBe(1_000_000 - minimum);
    });

    test("a bid above the cap offers to adjust to it; accepting settles the auction at the cap", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card AboveCap");
      const platformId = 'test-leilao-cmd-lance-abovecap';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder AboveCap", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const tooHigh = auction.capPrice + 500;
      const workflowID = `test-leilao-lance-abovecap-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(tooHigh)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id} ${tooHigh}`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: true }, 'leilao:confirm');
      await handle.getResult();

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBe(auction.capPrice);
      expect(row?.status).toBe('sold');
      expect(await getCoins(bidderId)).toBe(1_000_000 - auction.capPrice);
    });

    test("a bid above the cap, declining the adjustment leaves the auction untouched", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card AboveCapDecline");
      const platformId = 'test-leilao-cmd-lance-abovecap-decline';
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder AboveCapDecline", platform: 'telegram', platformId })).id;
      await setCoins(bidderId, 1_000_000);

      const tooHigh = auction.capPrice + 500;
      const workflowID = `test-leilao-lance-abovecap-decline-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['lance', String(auction.id), String(tooHigh)], platform: 'telegram', workflowID });
      const handle = await run(workflowID, ctx, `lance ${auction.id} ${tooHigh}`);

      await new Promise(r => setTimeout(r, 500));
      await DBOS.send(workflowID, { value: false }, 'leilao:confirm');
      await handle.getResult();

      const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
      expect(row?.currentBid).toBeNull();
      expect(await getCoins(bidderId)).toBe(1_000_000);
    });
  });

  describe("mostrar (ID nu)", () => {
    test("replies without throwing for an auction with no bids yet", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card Show NoBids");
      const workflowID = `test-leilao-show-nobids-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: 'test-leilao-cmd-show-nobids', args: [String(auction.id)], platform: 'telegram', workflowID });
      await run(workflowID, ctx, String(auction.id)).then(h => h.getResult());
    });

    test("replies without throwing for an auction with a current bidder", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card Show WithBid");
      const bidderId = (await fx.user({ displayName: "Test Leilao Cmd Bidder Show", platform: 'telegram', platformId: 'test-leilao-cmd-show-bidder' })).id;
      await setCoins(bidderId, 1_000_000);
      const bid = await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);
      expect(bid.ok).toBe(true);

      const workflowID = `test-leilao-show-withbid-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: 'test-leilao-cmd-show-withbid', args: [String(auction.id)], platform: 'telegram', workflowID });
      await run(workflowID, ctx, String(auction.id)).then(h => h.getResult());
    });

    test("replies without throwing for a resolved (non-active) auction", async () => {
      const auction = await freshAuction("Test Leilao Cmd Card Show Resolved");
      const closed = await AuctionsDB.forceCloseAuction(auction.id);
      expect(closed.ok).toBe(true);

      const workflowID = `test-leilao-show-resolved-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: 'test-leilao-cmd-show-resolved', args: [String(auction.id)], platform: 'telegram', workflowID });
      await run(workflowID, ctx, String(auction.id)).then(h => h.getResult());
    });

    test("replies without throwing for a nonexistent auction id", async () => {
      const workflowID = `test-leilao-show-missing-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: 'test-leilao-cmd-show-missing', args: ['999999999'], platform: 'telegram', workflowID });
      await run(workflowID, ctx, '999999999').then(h => h.getResult());
    });
  });

  describe("sem argumentos", () => {
    test("replies with the mini app link, without throwing", async () => {
      const workflowID = `test-leilao-link-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: 'test-leilao-cmd-link', args: [], platform: 'telegram', workflowID });
      await run(workflowID, ctx, '').then(h => h.getResult());
    });
  });

  describe("wish", () => {
    test("toggles a watch on, then off, for the calling user", async () => {
      const platformId = 'test-leilao-cmd-wish-toggle';
      const userId = (await fx.user({ displayName: "Test Leilao Cmd Wish Toggle", platform: 'telegram', platformId })).id;
      const cardId = (await fx.card({ name: "Test Leilao Cmd Wish Toggle Card", rarityId, subcategoryId })).id;

      const workflowID = `test-leilao-wish-toggle-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['wish', String(cardId)], platform: 'telegram', workflowID });
      await run(workflowID, ctx, `wish ${cardId}`).then(h => h.getResult());
      expect(await AuctionsDB.isWatchingCard(userId, cardId)).toBe(true);

      const workflowID2 = `test-leilao-wish-toggle-2-${Bun.randomUUIDv7()}`;
      const ctx2 = fakeCtx({ name: 'leilao', authorId: platformId, args: ['wish', String(cardId)], platform: 'telegram', workflowID: workflowID2 });
      await run(workflowID2, ctx2, `wish ${cardId}`).then(h => h.getResult());
      expect(await AuctionsDB.isWatchingCard(userId, cardId)).toBe(false);
    });

    test("no card given shows the watch list page instead, without throwing", async () => {
      const platformId = 'test-leilao-cmd-wish-nocard';
      await fx.user({ displayName: "Test Leilao Cmd Wish NoCard", platform: 'telegram', platformId });

      const workflowID = `test-leilao-wish-nocard-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['wish'], platform: 'telegram', workflowID });
      await run(workflowID, ctx, 'wish').then(h => h.getResult());
    });

    test("end-to-end: watching a card, then someone else auctioning it, queues exactly one alert for the watcher", async () => {
      const watcherPlatformId = 'test-leilao-cmd-wish-e2e-watcher';
      const watcherId = (await fx.user({ displayName: "Test Leilao Cmd Wish E2E Watcher", platform: 'telegram', platformId: watcherPlatformId })).id;
      const cardId = (await fx.card({ name: "Test Leilao Cmd Wish E2E Card", rarityId, subcategoryId })).id;

      const workflowID = `test-leilao-wish-e2e-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: watcherPlatformId, args: ['wish', String(cardId)], platform: 'telegram', workflowID });
      await run(workflowID, ctx, `wish ${cardId}`).then(h => h.getResult());
      expect(await AuctionsDB.isWatchingCard(watcherId, cardId)).toBe(true);

      const sellerId = (await fx.user({ displayName: "Test Leilao Cmd Wish E2E Seller" })).id;
      await fx.ownCard(sellerId, cardId, 1);
      await CardsDB.setCardTradable(sellerId, cardId, true);
      const created = await AuctionsDB.createAuction(sellerId, cardId);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const pending = await AuctionsDB.listUnnotifiedWatchAlerts(500);
      const forThisAuction = pending.filter(a => a.auctionId === created.auction.id);
      expect(forThisAuction).toHaveLength(1);
      expect(forThisAuction[0]!.userId).toBe(watcherId);
    });

    test("the card being in an active auction already doesn't block adding the watch", async () => {
      const auction = await freshAuction("Test Leilao Cmd Wish AlreadyActive");
      const platformId = 'test-leilao-cmd-wish-active';
      const userId = (await fx.user({ displayName: "Test Leilao Cmd Wish Active", platform: 'telegram', platformId })).id;

      const workflowID = `test-leilao-wish-active-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['wish', String(auction.cardId)], platform: 'telegram', workflowID });
      await run(workflowID, ctx, `wish ${auction.cardId}`).then(h => h.getResult());

      expect(await AuctionsDB.isWatchingCard(userId, auction.cardId)).toBe(true);
    });

    test("more than one active auction for the same card resolves without throwing and still adds the watch", async () => {
      const firstAuction = await freshAuction("Test Leilao Cmd Wish MultiActive");
      const cardId = firstAuction.cardId;

      // a second, independent owner lists the same cardId - both listings stay active at once.
      const sellerBId = (await fx.user({ displayName: "Test Leilao Cmd Wish MultiActive Seller B" })).id;
      await fx.ownCard(sellerBId, cardId, 1);
      await CardsDB.setCardTradable(sellerBId, cardId, true);
      const secondAuction = await AuctionsDB.createAuction(sellerBId, cardId);
      if (!secondAuction.ok) throw new Error('fixture setup failed');

      const platformId = 'test-leilao-cmd-wish-multiactive';
      const userId = (await fx.user({ displayName: "Test Leilao Cmd Wish MultiActive Watcher", platform: 'telegram', platformId })).id;

      const workflowID = `test-leilao-wish-multiactive-${Bun.randomUUIDv7()}`;
      const ctx = fakeCtx({ name: 'leilao', authorId: platformId, args: ['wish', String(cardId)], platform: 'telegram', workflowID });
      await run(workflowID, ctx, `wish ${cardId}`).then(h => h.getResult());

      expect(await AuctionsDB.isWatchingCard(userId, cardId)).toBe(true);
    });

    describe("empty-args listing page", () => {
      test("an empty watch list shows the empty state and a zero total", async () => {
        const platformId = 'test-leilao-cmd-wish-list-empty';
        await fx.user({ displayName: "Test Leilao Cmd Wish List Empty", platform: 'telegram', platformId });

        const page = await LeilaoCommand.leilaoWishPage(':', 0, platformId, 'telegram');
        expect(page).not.toBeNull();
        expect(page!.content).toContain('_Nenhum card na lista._');
        expect(page!.content).toContain('`0` cards no total.');
      });

      test("lists watched cards with category/rarity emoji, id, name and subcategory", async () => {
        const platformId = 'test-leilao-cmd-wish-list-basic';
        const userId = (await fx.user({ displayName: "Test Leilao Cmd Wish List Basic", platform: 'telegram', platformId })).id;
        const cardId = (await fx.card({ name: "Test Leilao Cmd Wish List Card", rarityId, subcategoryId })).id;
        await AuctionsDB.addWatch(userId, cardId);

        const page = await LeilaoCommand.leilaoWishPage(':', 0, platformId, 'telegram');
        expect(page!.content).toContain('Lista de desejos do leilão de **Test Leilao Cmd Wish List Basic**');
        expect(page!.content).toContain('`1` cards no total.');
        expect(page!.content).toContain(`\`${cardId}\`. **Test Leilao Cmd Wish List Card** — _Test Leilao Cmd Subcategory_`);
      });

      test("filter buttons narrow the list and show the advice line", async () => {
        const platformId = 'test-leilao-cmd-wish-list-filter';
        const userId = (await fx.user({ displayName: "Test Leilao Cmd Wish List Filter", platform: 'telegram', platformId })).id;
        const ownedCardId = (await fx.card({ name: "Test Leilao Cmd Wish List Filter Owned", rarityId, subcategoryId })).id;
        const missingCardId = (await fx.card({ name: "Test Leilao Cmd Wish List Filter Missing", rarityId, subcategoryId })).id;
        await AuctionsDB.addWatch(userId, ownedCardId);
        await AuctionsDB.addWatch(userId, missingCardId);
        await fx.ownCard(userId, ownedCardId, 3);

        // filter '1' = "que você possui" (ownedCount > 0), see WISH_FILTERS in leilao.ts
        const filteredArg = buildFilterArg(['1'], '');
        const page = await LeilaoCommand.leilaoWishPage(filteredArg, 0, platformId, 'telegram');
        expect(page!.content).toContain('🔎 Mostrando apenas cards **que você possui**');
        expect(page!.content).toContain('Test Leilao Cmd Wish List Filter Owned');
        expect(page!.content).not.toContain('Test Leilao Cmd Wish List Filter Missing');
      });

      test("pagination: more than one page's worth of watched cards splits correctly", async () => {
        const platformId = 'test-leilao-cmd-wish-list-page';
        const userId = (await fx.user({ displayName: "Test Leilao Cmd Wish List Page", platform: 'telegram', platformId })).id;
        for (let i = 0; i < 12; i++) {
          const cardId = (await fx.card({ name: `Test Leilao Cmd Wish List Page Card ${i}`, rarityId, subcategoryId })).id;
          await AuctionsDB.addWatch(userId, cardId);
        }

        const firstPage = await LeilaoCommand.leilaoWishPage(':', 0, platformId, 'telegram');
        expect(firstPage!.totalPages).toBe(2);
        expect(firstPage!.hasNext).toBe(true);
        expect(firstPage!.content).toContain('`12` cards no total.');

        const secondPage = await LeilaoCommand.leilaoWishPage(':', 1, platformId, 'telegram');
        expect(secondPage!.hasNext).toBe(false);
      });
    });
  });
});
