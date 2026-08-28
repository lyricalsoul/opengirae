import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards, auctions } from "../../schemas/cards";
import { users } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { CardsDB } from "../../cards";
import { AuctionsDB } from "../../auctions";

describe("CardsDB.getUserOwnedCardsBySubcategory", () => {
  const fx = new TestFixtures();
  let userId: number;
  let subcategoryId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Owned By Subcat" })).id;
    const categoryId = (await fx.category({ name: `Test Subcat Group Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Test Subcat Group Subcategory" })).id;

    const cardIds: number[] = [];
    for (let i = 0; i < 12; i++) cardIds.push((await fx.card({ name: `Subcat Group Card ${i}`, subcategoryId })).id);

    await db.insert(userCards).values(cardIds.map(cardId => ({ userId, cardId, count: 1 })));
    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("caps the preview at 10 cards even though 12 are owned, but reports the real total", async () => {
    const result = await CardsDB.getUserOwnedCardsBySubcategory(userId, { query: "Subcat Group Card" });
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.subcategoryId).toBe(subcategoryId);
    expect(result.rows[0]!.total).toBe(12);
    expect(result.rows[0]!.cards).toHaveLength(10);
  });

  test("a query matching no cards in this subcategory excludes it entirely", async () => {
    const result = await CardsDB.getUserOwnedCardsBySubcategory(userId, { query: "zzzznonexistentzzzz" });
    expect(result.rows.find(r => r.subcategoryId === subcategoryId)).toBeUndefined();
  });

  test("reports tradable per card", async () => {
    const result = await CardsDB.getUserOwnedCardsBySubcategory(userId, { query: "Subcat Group Card" });
    const firstCard = result.rows[0]!.cards[0]!;
    expect(firstCard).toHaveProperty('tradable');

    await db.update(userCards).set({ tradable: true }).where(eq(userCards.cardId, firstCard.id));
    const refreshed = await CardsDB.getUserOwnedCardsBySubcategory(userId, { query: "Subcat Group Card" });
    expect(refreshed.rows[0]!.cards.find(c => c.id === firstCard.id)?.tradable).toBe(true);
  });

  test("a card currently in the user's own active auction still counts as owned, marked inAuction", async () => {
    const rarityId = (await fx.rarity({ name: `Test Owned Auction Rarity ${Date.now()}`, auctionBaseValue: 10000 })).id;
    const auctionSubcategoryId = (await fx.subcategory({ categoryId: (await fx.category({ name: `Test Owned Auction Category ${Date.now()}` })).id, name: "Test Owned Auction Subcategory" })).id;
    const cardId = (await fx.card({ name: "Test Owned Auction Card", rarityId, subcategoryId: auctionSubcategoryId })).id;

    await fx.ownCard(userId, cardId, 1);
    await CardsDB.setCardTradable(userId, cardId, true);
    await db.update(users).set({ coins: 1_000_000 }).where(eq(users.id, userId));
    const created = await AuctionsDB.createAuction(userId, cardId);
    if (!created.ok) throw new Error(`fixture setup failed: ${created.reason}`);
    fx.onCleanup(async () => { await db.delete(auctions).where(eq(auctions.id, created.auction.id)); });

    // the card's last copy is now physically out of userCards for the auction's duration
    expect(await db.select().from(userCards).where(eq(userCards.cardId, cardId)).then(r => r.length)).toBe(0);

    const result = await CardsDB.getUserOwnedCardsBySubcategory(userId, { query: "Test Owned Auction Card" });
    const row = result.rows.find(r => r.subcategoryId === auctionSubcategoryId);
    expect(row).toBeDefined();
    const cardRow = row!.cards.find(c => c.id === cardId);
    expect(cardRow).toBeDefined();
    expect(cardRow!.inAuction).toBe(true);
    expect(cardRow!.ownedCount).toBe(0);
  });

  test("with multiple copies, only the auctioned one is locked - ownedCount reflects the rest, still free to trade/discard", async () => {
    const rarityId = (await fx.rarity({ name: `Test Owned Auction Multi Rarity ${Date.now()}`, auctionBaseValue: 10000 })).id;
    const multiSubcategoryId = (await fx.subcategory({ categoryId: (await fx.category({ name: `Test Owned Auction Multi Category ${Date.now()}` })).id, name: "Test Owned Auction Multi Subcategory" })).id;
    const cardId = (await fx.card({ name: "Test Owned Auction Multi Card", rarityId, subcategoryId: multiSubcategoryId })).id;

    // 3 copies owned, only 1 gets auctioned off - the other 2 must stay fully free
    await fx.ownCard(userId, cardId, 3);
    await CardsDB.setCardTradable(userId, cardId, true);
    await db.update(users).set({ coins: 1_000_000 }).where(eq(users.id, userId));
    const created = await AuctionsDB.createAuction(userId, cardId);
    if (!created.ok) throw new Error(`fixture setup failed: ${created.reason}`);
    fx.onCleanup(async () => { await db.delete(auctions).where(eq(auctions.id, created.auction.id)); });

    // 2 copies remain physically in userCards - the row wasn't deleted, just decremented
    expect(await db.select().from(userCards).where(eq(userCards.cardId, cardId)).then(r => r[0]?.count)).toBe(2);

    const result = await CardsDB.getUserOwnedCardsBySubcategory(userId, { query: "Test Owned Auction Multi Card" });
    const row = result.rows.find(r => r.subcategoryId === multiSubcategoryId);
    const cardRow = row!.cards.find(c => c.id === cardId);
    expect(cardRow!.inAuction).toBe(true);
    // ownedCount must stay at the free/actionable count (2), NOT include the auctioned unit -
    // CardRows.svelte's discard/trade quantity stepper caps out at this number, so inflating it
    // would let someone try to act on a copy that isn't actually theirs to use right now.
    expect(cardRow!.ownedCount).toBe(2);
  });
});
