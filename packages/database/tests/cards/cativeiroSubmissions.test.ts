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

  const submitter = {
    platform: "telegram",
    platformId: "test-submitter-123",
    name: "Test Submitter",
    chatId: "test-submitter-123",
  };

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Submission User" })).id;
    cardId = (await fx.card({ name: "Test Submission Card" })).id;
    await fx.ownCard(userId, cardId, 1);

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
});
