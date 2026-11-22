import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, TestFixtures, waitFor } from "@girae/tests";
import { db } from "@girae/database/index";
import { auctionWatchNotifications, auctionWatches, auctions, userCards } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import { AuctionsDB } from "@girae/database/auctions";
import { sendAuctionWatchNotifications, drainAuctionOutboxes } from "../../services/auctions/notifications";

const { sentMessages } = mockTelegram();

describe("auction outboxes", () => {
  const fx = new TestFixtures();
  let watcherId: number, watcherPlatformId: string, auctionId: number;

  beforeAll(async () => {
    await bootstrapCommandeerWorkers();
    watcherPlatformId = `test-outbox-watcher-${Bun.randomUUIDv7()}`;
    watcherId = (await fx.user({ displayName: "Test Outbox Watcher", platform: 'telegram', platformId: watcherPlatformId })).id;
    const sellerId = (await fx.user({ displayName: "Test Outbox Seller" })).id;
    const categoryId = (await fx.category()).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test Outbox Sub ${Bun.randomUUIDv7()}` })).id;
    const rarityId = (await fx.rarity({ name: `Test Outbox Rarity ${Bun.randomUUIDv7()}`, auctionBaseValue: 10000 })).id;
    const cardId = (await fx.card({ name: `Test Outbox Card ${Bun.randomUUIDv7()}`, rarityId, subcategoryId })).id;

    await fx.ownCard(sellerId, cardId, 1);
    await CardsDB.setCardTradable(sellerId, cardId, true);
    await AuctionsDB.addWatch(watcherId, cardId);
    const created = await AuctionsDB.createAuction(sellerId, cardId);
    if (!created.ok) throw new Error(`fixture setup failed: ${created.reason}`);
    auctionId = created.auction.id;

    // registered last so it runs first: the auction row is what the outbox rows and bids reference
    fx.onCleanup(async () => {
      await db.delete(auctionWatchNotifications).where(eq(auctionWatchNotifications.auctionId, auctionId));
      await db.delete(auctionWatches).where(eq(auctionWatches.userId, watcherId));
      await db.delete(auctions).where(eq(auctions.id, auctionId));
      await db.delete(userCards).where(eq(userCards.userId, sellerId));
    });
  });

  afterAll(() => fx.cleanup());

  test("sendAuctionWatchNotifications DMs the watcher and marks the alert notified", async () => {
    const startIndex = sentMessages.length;
    await sendAuctionWatchNotifications(100_000);

    const dm = await waitFor(() => sentMessages.slice(startIndex).find(m => String(m.chatId) === watcherPlatformId && String(m.text).includes('Card em leilão')), { label: 'watch alert DM' });
    expect(dm).toBeDefined();

    const [alert] = await db.select().from(auctionWatchNotifications).where(eq(auctionWatchNotifications.auctionId, auctionId));
    expect(alert?.notifiedAt).not.toBeNull();
  });

  test("drainAuctionOutboxes drains the watch alerts too (d3e05ec dropped that call from the sweep once)", async () => {
    expect(drainAuctionOutboxes.toString()).toContain('sendAuctionWatchNotifications');
    const cronSource = await Bun.file(new URL("../../cron.ts", import.meta.url)).text();
    expect(cronSource).toContain('drainAuctionOutboxes()');
  });
});
