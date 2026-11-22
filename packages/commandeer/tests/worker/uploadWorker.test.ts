import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, mockTelegram, bootstrapCommandeerWorkers, waitFor, hasRealStorage } from "@girae/tests";
import { uploadQueue } from "@girae/common/queue";
import { db } from "@girae/database/index";
import { cardCustomizationSubmissions } from "@girae/database/schemas/cards";
import { eq, and } from "drizzle-orm";

describe("uploadWorker", () => {
  const fx = new TestFixtures();
  let userId: number;
  let cardId: number;

  beforeAll(async () => {
    mockTelegram();
    await bootstrapCommandeerWorkers();
    userId = (await fx.user({ displayName: "Test Upload Worker" })).id;
    cardId = (await fx.card({ name: "Test Upload Worker Card" })).id;
  });

  afterAll(() => fx.cleanup());

  // a data: URI avoids depending on a flaky real network fetch for the "source" side of
  // uploadFromUrl, while still exercising the real fetch()/S3-write code path (this codebase
  // exercises real infra rather than mocking it - see 03-commands.md's testing conventions).
  const TEST_IMAGE_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  test.skipIf(!hasRealStorage)("processes a queued job into a pending cativeiro submission", async () => {
    await uploadQueue.add('processUpload', {
      userId, cardId,
      photoUrl: TEST_IMAGE_DATA_URI,
      isVideo: false,
      ctx: { platform: 'telegram', authorId: 'test-uploader', authorName: 'Test Uploader', chatId: 'test-chat', threadId: undefined },
    });

    const pending = await waitFor(() => db.select().from(cardCustomizationSubmissions)
      .where(and(eq(cardCustomizationSubmissions.userId, userId), eq(cardCustomizationSubmissions.cardId, cardId)))
      .then(rows => rows[0]), { label: 'the worker to create the submission' });
    expect(pending).toBeTruthy();
    expect(pending?.mediaType).toBe('photo');
    expect(pending?.status).toBe('pending');

    fx.onCleanup(async () => { await db.delete(cardCustomizationSubmissions).where(eq(cardCustomizationSubmissions.userId, userId)); });
  });
});
