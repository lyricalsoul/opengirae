import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { CardsDB } from "../../cards";
import { db } from "../../index";
import { userCards } from "../../schemas/cards";
import { eq, and } from "drizzle-orm";

// Primitives behind AuditDB.revertDonation's penalty chain - exercised directly since revertDonation.test.ts uses a high cativeiro threshold to dodge the clearing branch tested here.
describe("CardsDB's donation-revert helper primitives", () => {
  let fx: TestFixtures;
  let userId: number;
  let rarityId: number, otherRarityId: number;
  let cardAId: number, cardBId: number, cardCId: number; // A/B share rarityId, C is otherRarityId

  beforeEach(async () => {
    fx = new TestFixtures();
    userId = (await fx.user({ displayName: "Test Revert Helper User" })).id;
    rarityId = (await fx.rarity({ name: `Test Revert Helper Rarity ${Bun.randomUUIDv7()}`, cativeiroThreshold: 3 })).id;
    otherRarityId = (await fx.rarity({ name: `Test Revert Helper Other Rarity ${Bun.randomUUIDv7()}` })).id;
    cardAId = (await fx.card({ name: "Test Revert Helper Card A", rarityId })).id;
    cardBId = (await fx.card({ name: "Test Revert Helper Card B", rarityId })).id;
    cardCId = (await fx.card({ name: "Test Revert Helper Card C", rarityId: otherRarityId })).id;

    fx.onCleanup(async () => { await db.delete(userCards).where(eq(userCards.userId, userId)); });
  });

  afterEach(() => fx.cleanup());

  describe("tryDecrementOneWithClient", () => {
    test("returns false when the user doesn't own the card at all", async () => {
      const ok = await db.transaction(client => CardsDB.tryDecrementOneWithClient(client, userId, cardAId));
      expect(ok).toBe(false);
    });

    test("decrements by one and keeps the row when count stays above 0", async () => {
      await fx.ownCard(userId, cardAId, 2);
      const ok = await db.transaction(client => CardsDB.tryDecrementOneWithClient(client, userId, cardAId));
      expect(ok).toBe(true);
      const row = await db.select().from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardAId))).then(r => r[0]);
      expect(row?.count).toBe(1);
    });

    test("deletes the row once count reaches 0", async () => {
      await fx.ownCard(userId, cardAId, 1);
      const ok = await db.transaction(client => CardsDB.tryDecrementOneWithClient(client, userId, cardAId));
      expect(ok).toBe(true);
      const row = await db.select().from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardAId))).then(r => r[0]);
      expect(row).toBeUndefined();
    });

    test("clears cativeiro customization once the remaining count drops below the rarity's threshold", async () => {
      await fx.ownCard(userId, cardAId, 4); // rarityId's cativeiroThreshold is 3
      await db.update(userCards)
        .set({ customEmoji: '💎', customMediaUrl: 'https://example.com/x.jpg', customMediaType: 'photo' })
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardAId)));

      await db.transaction(client => CardsDB.tryDecrementOneWithClient(client, userId, cardAId));
      const stillEligible = await db.select().from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardAId))).then(r => r[0]);
      expect(stillEligible?.count).toBe(3); // still >= threshold - kept
      expect(stillEligible?.customEmoji).toBe('💎');

      await db.transaction(client => CardsDB.tryDecrementOneWithClient(client, userId, cardAId));
      const nowIneligible = await db.select().from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardAId))).then(r => r[0]);
      expect(nowIneligible?.count).toBe(2); // below threshold now - cleared
      expect(nowIneligible?.customEmoji).toBeNull();
      expect(nowIneligible?.customMediaUrl).toBeNull();
      expect(nowIneligible?.customMediaType).toBeNull();
    });
  });

  describe("getCardRarityIdWithClient", () => {
    test("returns the card's rarity id", async () => {
      const id = await db.transaction(client => CardsDB.getCardRarityIdWithClient(client, cardAId));
      expect(id).toBe(rarityId);
    });

    test("returns null for a nonexistent card", async () => {
      const id = await db.transaction(client => CardsDB.getCardRarityIdWithClient(client, 999999999));
      expect(id).toBeNull();
    });
  });

  describe("findOwnedCardOfRarityWithClient", () => {
    test("finds a card of the given rarity the user owns", async () => {
      await fx.ownCard(userId, cardBId, 1);
      const id = await db.transaction(client => CardsDB.findOwnedCardOfRarityWithClient(client, userId, rarityId));
      expect(id).toBe(cardBId);
    });

    test("ignores cards of a different rarity", async () => {
      await fx.ownCard(userId, cardCId, 1);
      const id = await db.transaction(client => CardsDB.findOwnedCardOfRarityWithClient(client, userId, rarityId));
      expect(id).toBeNull();
    });

    test("returns null when the user owns nothing of that rarity", async () => {
      const id = await db.transaction(client => CardsDB.findOwnedCardOfRarityWithClient(client, userId, rarityId));
      expect(id).toBeNull();
    });
  });
});
