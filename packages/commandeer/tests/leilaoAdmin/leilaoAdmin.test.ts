import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { userCards, auctions, auctionBids, subcategoryCompletionRewards } from "@girae/database/schemas/cards";
import { eq, sql } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import { AuctionsDB, type Auction } from "@girae/database/auctions";
import LeilaoForcarCommand from "../../commands/admin/leilaoforcar";
import LeilaoCancelarCommand from "../../commands/admin/leilaocancelar";

mockTelegram();

async function setCoins(userId: number, amount: number) {
  await db.update(users).set({ coins: amount }).where(eq(users.id, userId));
}

describe("leilão admin commands", () => {
  const fx = new TestFixtures();
  let rarityId: number;
  let subcategoryId: number;
  let sellerId: number;
  let adminPlatformId: string;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    const categoryId = (await fx.category({ name: `Test Leilao Admin Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Leilao Admin Subcategory" })).id;
    rarityId = (await fx.rarity({ name: `Test Leilao Admin Rarity ${Date.now()}`, auctionBaseValue: 10000 })).id;
    sellerId = (await fx.user({ displayName: "Test Leilao Admin Seller" })).id;
    await setCoins(sellerId, 1_000_000);
    adminPlatformId = 'test-leilao-admin-staff';
    await fx.user({ displayName: "Test Leilao Admin Staff", platform: 'telegram', platformId: adminPlatformId });
  });

  afterAll(async () => {
    await db.delete(auctionBids).where(sql`"auctionId" IN (SELECT id FROM ${auctions} WHERE "sellerId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao Admin%'))`);
    await db.delete(auctions).where(sql`"sellerId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao Admin%')`);
    await db.delete(subcategoryCompletionRewards).where(eq(subcategoryCompletionRewards.subcategoryId, subcategoryId));
    await db.delete(userCards).where(sql`"userId" IN (SELECT id FROM ${users} WHERE "displayName" LIKE 'Test Leilao Admin%')`);
    await fx.cleanup();
  });

  async function freshAuction(cardName: string): Promise<Auction> {
    const cardId = (await fx.card({ name: cardName, rarityId, subcategoryId })).id;
    await fx.ownCard(sellerId, cardId, 1);
    await CardsDB.setCardTradable(sellerId, cardId, true);
    const result = await AuctionsDB.createAuction(sellerId, cardId);
    if (!result.ok) throw new Error(`fixture setup failed: ${result.reason}`);
    return result.auction;
  }

  test("/leilaoforcar closes an active auction as an ordinary expiry when there are no bids", async () => {
    const auction = await freshAuction("Test Leilao Admin Card Force");
    const ctx = fakeCtx({ name: 'leilaoforcar', authorId: adminPlatformId, args: [String(auction.id)], platform: 'telegram' });
    await LeilaoForcarCommand.execute(ctx, { auctionId: auction.id });

    const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
    expect(row?.status).toBe('expired');
  });

  test("/leilaocancelar refunds the current bidder in full even mid-auction", async () => {
    const auction = await freshAuction("Test Leilao Admin Card Cancel");
    const bidderId = (await fx.user({ displayName: "Test Leilao Admin Bidder" })).id;
    await setCoins(bidderId, 1_000_000);
    await AuctionsDB.placeBid(auction.id, bidderId, auction.startingBid);

    const ctx = fakeCtx({ name: 'leilaocancelar', authorId: adminPlatformId, args: [String(auction.id)], platform: 'telegram' });
    await LeilaoCancelarCommand.execute(ctx, { auctionId: auction.id });

    const row = await db.select().from(auctions).where(eq(auctions.id, auction.id)).then(r => r[0]);
    expect(row?.status).toBe('cancelled');
    expect(await db.select({ coins: users.coins }).from(users).where(eq(users.id, bidderId)).then(r => r[0]!.coins)).toBe(1_000_000);
  });
});
