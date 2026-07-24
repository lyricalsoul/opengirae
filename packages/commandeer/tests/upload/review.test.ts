import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { cardCustomizationSubmissions } from "@girae/database/schemas/cards";
import { auditLogs } from "@girae/database/schemas/audit";
import { eq } from "drizzle-orm";
import UploadCommand from "../../commands/all/upload.cards";

mockTelegram();

describe("/upload's cativeiroApprove/cativeiroReject QuickViews", () => {
  const fx = new TestFixtures();
  let userId: number;
  let reviewerId: number;
  let reviewerPlatformId: string;
  let cardId: number;

  const submitter = { platform: 'none', platformId: 'test-review-submitter', name: 'Test Submitter', chatId: 'test-review-submitter' };

  beforeAll(async () => {
    await import("@girae/answerer/index");

    reviewerPlatformId = `test-reviewer-${Bun.randomUUIDv7()}`;
    const reviewer = await fx.user({ displayName: "Test Reviewer", platform: 'telegram', platformId: reviewerPlatformId });
    reviewerId = reviewer.id;
    const owner = await fx.user({ displayName: "Test Review Owner", platform: 'none', platformId: submitter.platformId });
    userId = owner.id;
    cardId = (await fx.card({ name: "Test Review Card" })).id;
    await fx.ownCard(userId, cardId, 1);

    fx.onCleanup(async () => { await db.delete(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.userId, userId)); });
    // approve/reject write AuditDB.log(reviewer.id, ...) rows - must clear those before the
    // reviewer fixture's own cleanup deletes the user, or the FK on audit_logs blocks it.
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, reviewerId)); });
  });

  afterAll(() => fx.cleanup());

  test("approve writes the customization onto userCards and is a no-op on a second click", async () => {
    const submitResult = await CardsDB.createCativeiroSubmission(userId, cardId, 'https://example.com/approved.jpg', 'photo', submitter);
    const submissionId = submitResult.submission!.id;

    const firstClick = await UploadCommand.cativeiroApprove(String(submissionId), reviewerPlatformId, 'telegram');
    expect(firstClick).toBe('✅ Aprovado!');

    const owned = await CardsDB.getUserCard(userId, cardId);
    expect(owned?.customMediaUrl).toBe('https://example.com/approved.jpg');

    const secondClick = await UploadCommand.cativeiroApprove(String(submissionId), reviewerPlatformId, 'telegram');
    expect(secondClick).toContain('já foi revisada');
  });

  test("reject doesn't touch userCards and is a no-op on a second click", async () => {
    const before = await CardsDB.getUserCard(userId, cardId);
    const submitResult = await CardsDB.createCativeiroSubmission(userId, cardId, 'https://example.com/rejected.jpg', 'photo', submitter);
    const submissionId = submitResult.submission!.id;

    const firstClick = await UploadCommand.cativeiroReject(String(submissionId), reviewerPlatformId, 'telegram');
    expect(firstClick).toBe('❌ Rejeitado.');

    const after = await CardsDB.getUserCard(userId, cardId);
    expect(after?.customMediaUrl).toBe(before?.customMediaUrl);

    const secondClick = await UploadCommand.cativeiroReject(String(submissionId), reviewerPlatformId, 'telegram');
    expect(secondClick).toContain('já foi revisada');
  });

  test("an unknown submission id is handled gracefully", async () => {
    const result = await UploadCommand.cativeiroApprove('999999999', reviewerPlatformId, 'telegram');
    expect(result).toContain('já foi revisada');
  });
});
