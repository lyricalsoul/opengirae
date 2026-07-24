import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { db } from "../../index";
import { userCards, cardCustomizationSubmissions } from "../../schemas/cards";
import { eq, and } from "drizzle-orm";
import { CardsDB } from "../../cards";

describe("CardsDB cativeiro submissions", () => {
  const fx = new TestFixtures();
  let userId: number;
  let cardId: number;
  const THRESHOLD = 5;

  const submitter = {
    platform: "telegram",
    platformId: "test-submitter-123",
    name: "Test Submitter",
    chatId: "test-submitter-123",
  };

  beforeAll(async () => {
    const rarityId = (await fx.rarity({ name: "Test Submission Rarity", cativeiroThreshold: THRESHOLD })).id;
    userId = (await fx.user({ displayName: "Test Submission User" })).id;
    cardId = (await fx.card({ name: "Test Submission Card", rarityId })).id;
    await fx.ownCard(userId, cardId, THRESHOLD);

    fx.onCleanup(async () => {
      await db.delete(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.userId, userId));
    });
  });

  afterAll(() => fx.cleanup());

  test("creates a pending submission", async () => {
    const result = await CardsDB.createCativeiroSubmission(userId, cardId, "https://example.com/a.jpg", "photo", submitter);
    expect(result.ok).toBe(true);
    expect(result.submission?.status).toBe("pending");
  });

  test("rejects a second concurrent pending submission for the same user+card", async () => {
    const result = await CardsDB.createCativeiroSubmission(userId, cardId, "https://example.com/b.jpg", "photo", submitter);
    expect(result).toEqual({ ok: false, reason: "already_pending" });
  });

  test("approve atomically flips status and writes the customization onto userCards", async () => {
    const pending = await db.select().from(cardCustomizationSubmissions)
      .where(and(eq(cardCustomizationSubmissions.userId, userId), eq(cardCustomizationSubmissions.status, "pending")))
      .then(r => r[0]!);

    const result = await CardsDB.approveCativeiroSubmission(pending.id);
    expect(result.ok).toBe(true);

    const owned = await CardsDB.getUserCard(userId, cardId);
    expect(owned?.customMediaUrl).toBe("https://example.com/a.jpg");
    expect(owned?.customMediaType).toBe("photo");
  });

  test("a second approve on an already-decided submission is a no-op", async () => {
    const decided = await db.select().from(cardCustomizationSubmissions)
      .where(eq(cardCustomizationSubmissions.userId, userId))
      .then(r => r.find(s => s.status === "approved")!);

    const result = await CardsDB.approveCativeiroSubmission(decided.id);
    expect(result).toEqual({ ok: false, reason: "not_pending" });
  });

  test("reject flips status without touching userCards", async () => {
    const submitResult = await CardsDB.createCativeiroSubmission(userId, cardId, "https://example.com/c.jpg", "video", submitter);
    expect(submitResult.ok).toBe(true);

    const beforeReject = await CardsDB.getUserCard(userId, cardId);

    const result = await CardsDB.rejectCativeiroSubmission(submitResult.submission!.id);
    expect(result.ok).toBe(true);

    const afterReject = await CardsDB.getUserCard(userId, cardId);
    expect(afterReject?.customMediaUrl).toBe(beforeReject?.customMediaUrl);
    expect(afterReject?.customMediaType).toBe(beforeReject?.customMediaType);
  });

  test("a second reject on an already-decided submission is a no-op", async () => {
    const decided = await db.select().from(cardCustomizationSubmissions)
      .where(and(eq(cardCustomizationSubmissions.userId, userId), eq(cardCustomizationSubmissions.status, "rejected")))
      .then(r => r[0]!);

    const result = await CardsDB.rejectCativeiroSubmission(decided.id);
    expect(result).toEqual({ ok: false, reason: "not_pending" });
  });

  test("approving a stale submission after the user dropped below threshold is rejected, not silently resurrected", async () => {
    const submitResult = await CardsDB.createCativeiroSubmission(userId, cardId, "https://example.com/d.jpg", "photo", submitter);
    expect(submitResult.ok).toBe(true);

    // simulate the user discarding/trading away copies while the submission sat pending -
    // drop below THRESHOLD directly (bypassing CardsDB.discardUserCards, which would already
    // clear customization itself - the point here is to isolate approveCativeiroSubmission's
    // own re-check).
    await db.update(userCards).set({ count: THRESHOLD - 1 }).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));

    try {
      const beforeApprove = await CardsDB.getUserCard(userId, cardId);

      const result = await CardsDB.approveCativeiroSubmission(submitResult.submission!.id);
      expect(result).toEqual({ ok: false, reason: "not_eligible" });

      const afterApprove = await CardsDB.getUserCard(userId, cardId);
      expect(afterApprove?.customMediaUrl).toBe(beforeApprove?.customMediaUrl);
      expect(afterApprove?.customMediaType).toBe(beforeApprove?.customMediaType);

      // still pending - staff can revisit once eligibility is restored, or reject it outright
      const [stillPending] = await db.select().from(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.id, submitResult.submission!.id));
      expect(stillPending!.status).toBe("pending");
    } finally {
      await db.update(userCards).set({ count: THRESHOLD }).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)));
      await CardsDB.rejectCativeiroSubmission(submitResult.submission!.id);
    }
  });
});
