import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { cardCustomizationSubmissions } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import UploadCommand from "../../commands/all/upload.cards";

// answerer's `worker` is a process-wide singleton - mock unconditionally so this file can't
// win the race and leave others talking to real Telegram.
mockTelegram();

// Only exercises the validation branches that return before any S3/storage call - a real
// upload (uploadFromUrl -> S3) needs credentials this environment doesn't have configured,
// and every path below short-circuits well before that call is ever made.
describe("/upload validation branches (pre-upload)", () => {
  const fx = new TestFixtures();
  let authorId: string;
  let cardId: number;
  let card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>;

  beforeAll(async () => {
    await import("@girae/answerer/index");

    authorId = `test-upload-${Bun.randomUUIDv7()}`;
    await fx.user({ displayName: "Test Upload", platform: 'none', platformId: authorId });
    const rarityId = (await fx.rarity({ name: "Test Upload Rarity", cativeiroThreshold: 1 })).id;
    cardId = (await fx.card({ name: "Test Upload Card", rarityId })).id;
    card = (await CardsDB.getCardWithDetails(cardId))!;

    fx.onCleanup(async () => { await db.delete(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.cardId, cardId)); });
  });

  afterAll(() => fx.cleanup());

  test("no id given shows the upload tutorial and doesn't create a submission", async () => {
    const ctx = fakeCtx({ name: 'upload', authorId });
    await expect(UploadCommand.execute(ctx, { card: undefined })).resolves.toBeUndefined();

    const submissions = await db.select().from(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.cardId, cardId));
    expect(submissions).toHaveLength(0);
  });

  test("no media anywhere on the message resolves without creating a submission", async () => {
    const ctx = fakeCtx({ name: 'upload', authorId, args: [String(cardId)] });
    await expect(UploadCommand.execute(ctx, { card })).resolves.toBeUndefined();

    const submissions = await db.select().from(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.cardId, cardId));
    expect(submissions).toHaveLength(0);
  });

  test("an oversized video is rejected before any submission is created", async () => {
    const ctx = fakeCtx({
      name: 'upload', authorId, args: [String(cardId)],
      replyToAuthorId: authorId,
      replyToPhotoUrl: 'https://example.com/big-video.mp4',
      replyToIsVideo: true,
      replyToFileSizeBytes: 60 * 1024 * 1024, // over the 50MB cap
    });
    await expect(UploadCommand.execute(ctx, { card })).resolves.toBeUndefined();

    const submissions = await db.select().from(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.cardId, cardId));
    expect(submissions).toHaveLength(0);
  });

  // Regression: the size cap used to only apply when isVideo was true, so an oversized
  // photo (or a video Telegram's own getFile refused, leaving isVideo unset) sailed
  // through unchecked.
  test("an oversized photo is rejected too, not just video", async () => {
    const ctx = fakeCtx({
      name: 'upload', authorId, args: [String(cardId)],
      replyToAuthorId: authorId,
      replyToPhotoUrl: 'https://example.com/big-photo.jpg',
      replyToFileSizeBytes: 60 * 1024 * 1024, // over the 50MB cap, isVideo left unset
    });
    await expect(UploadCommand.execute(ctx, { card })).resolves.toBeUndefined();

    const submissions = await db.select().from(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.cardId, cardId));
    expect(submissions).toHaveLength(0);
  });

  // Regression: the size check used to run after the "no photoUrl" check, so a file whose
  // .fetch() failed (no photoUrl at all, just a known size) fell through to the generic
  // "não encontrei mídia" message instead of the specific size-limit one.
  test("size is checked even when photoUrl itself is missing (a failed upstream fetch)", async () => {
    const ctx = fakeCtx({
      name: 'upload', authorId, args: [String(cardId)],
      replyToAuthorId: authorId,
      replyToIsVideo: true,
      replyToFileSizeBytes: 90 * 1024 * 1024, // no replyToPhotoUrl at all
    });
    await expect(UploadCommand.execute(ctx, { card })).resolves.toBeUndefined();

    const submissions = await db.select().from(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.cardId, cardId));
    expect(submissions).toHaveLength(0);
  });
});
