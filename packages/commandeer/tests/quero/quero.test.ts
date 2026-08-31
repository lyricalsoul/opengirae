import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { subcategoryGoals } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import QueroCommand, { renderPage } from "../../commands/cards/quero";

// answerer's `worker` is a process-wide singleton - mock unconditionally so this file can't win the race and leave others talking to real Telegram.
const { sentMessages } = mockTelegram();

async function waitForSentMessage(minLength: number, timeoutMs = 5000): Promise<void> {
  const startTime = Date.now();
  while (sentMessages.length < minLength) {
    if (Date.now() - startTime > timeoutMs) throw new Error(`Timeout waiting for sentMessages.length >= ${minLength}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

// Regression: multi-word names (the normal case) fell through to bulk-ID mode and choked on the first word.
describe("/quero multi-word name resolution", () => {
  const fx = new TestFixtures();
  let userId: number;
  let subcategoryId: number;
  const authorId = 'test-quero-author';

  beforeAll(async () => {
    // reply() blocks on job.waitUntilFinished() - needs a real worker consuming the queue.
    await import("@girae/answerer/index");

    userId = (await fx.user({ displayName: "Test Quero", platformId: authorId })).id;
    const categoryId = (await fx.category({ name: "Test Quero Category" })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: "Zzzyx Multiword Test Collection" })).id;

    fx.onCleanup(async () => { await db.delete(subcategoryGoals).where(eq(subcategoryGoals.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  function ctxFor(args: string[]) {
    return fakeCtx({ name: 'quero', authorId, args });
  }

  test("a multi-word collection name toggles the goal instead of being treated as bulk IDs", async () => {
    expect(await CardsDB.isOnGoals(userId, subcategoryId)).toBe(false);

    await QueroCommand.execute(ctxFor(['Zzzyx', 'Multiword', 'Test', 'Collection']));
    expect(await CardsDB.isOnGoals(userId, subcategoryId)).toBe(true);

    await QueroCommand.execute(ctxFor(['Zzzyx', 'Multiword', 'Test', 'Collection']));
    expect(await CardsDB.isOnGoals(userId, subcategoryId)).toBe(false);
  });

  test("a single numeric token resolves by ID (single-item path, not bulk)", async () => {
    await QueroCommand.execute(ctxFor([String(subcategoryId)]));
    expect(await CardsDB.isOnGoals(userId, subcategoryId)).toBe(true);
    await CardsDB.removeFromGoals(userId, subcategoryId);
  });

  test("multiple numeric tokens go through bulk-ID mode", async () => {
    await QueroCommand.execute(ctxFor([String(subcategoryId), '999999']));
    // the unresolved id (999999) should block the whole batch, per /quero's not-found reporting
    expect(await CardsDB.isOnGoals(userId, subcategoryId)).toBe(false);
  });
});

// platform: 'none' never reaches the mocked Telegram client, so this needs a real platform to assert reply content.
describe("/quero with no args", () => {
  const fx = new TestFixtures();
  const authorId = 'test-quero-noargs-author';

  beforeAll(async () => {
    await import("@girae/answerer/index");
    await fx.user({ displayName: "Test Quero No Args", platform: 'telegram', platformId: authorId });
  });

  afterAll(() => fx.cleanup());

  test("shows the favorite-collections list instead of the usage message", async () => {
    const startIndex = sentMessages.length;
    await QueroCommand.execute(fakeCtx({ name: 'quero', authorId, args: [], platform: 'telegram' }));
    await waitForSentMessage(startIndex + 1);

    const msg = sentMessages[sentMessages.length - 1]!;
    const content = msg.text ?? msg.content ?? "";
    expect(content).toContain("coleções favoritas");
    expect(content).not.toContain("Uso:");
  });
});

describe("/quero list with no favorites", () => {
  const fx = new TestFixtures();
  const authorId = `test-quero-list-empty-${Date.now()}`;

  beforeAll(async () => {
    await fx.user({ displayName: "Test Quero List Empty", platform: 'telegram', platformId: authorId });
  });

  afterAll(() => fx.cleanup());

  test("shows the empty-state message, no photo, no pagination", async () => {
    const page = await renderPage(0, authorId, 'telegram');
    expect(page?.content).toContain('_Nenhuma coleção encontrada._');
    expect(page?.photoUrl).toBeUndefined();
    expect(page?.hasNext).toBe(false);
    expect(page?.totalPages).toBe(1);
  });
});

describe("/quero list pagination and banner", () => {
  const fx = new TestFixtures();
  const authorId = `test-quero-list-many-${Date.now()}`;
  let userId: number;
  let categoryId: number;
  let firstSubcategoryId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Quero List Many", platform: 'telegram', platformId: authorId })).id;
    categoryId = (await fx.category({ name: `Test Quero List Category ${Date.now()}` })).id;

    for (let i = 0; i < 12; i++) {
      const sub = await fx.subcategory({ categoryId, name: `Test Quero List Sub ${i}` });
      if (i === 0) {
        firstSubcategoryId = sub.id;
        await CardsDB.updateSubcategory(sub.id, { imageUrl: 'https://example.com/first-banner.png' });
      }
      await CardsDB.addToGoals(userId, sub.id);
      // keep insertion order stable (getGoals orders by createdAt)
      await new Promise(r => setTimeout(r, 5));
    }

    fx.onCleanup(async () => { await db.delete(subcategoryGoals).where(eq(subcategoryGoals.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("page 0 lists the first 10, has a next page, and shows the first-ever favorite's banner", async () => {
    const page = await renderPage(0, authorId, 'telegram');
    expect(page?.content.match(/`\d+`\. \*\*/g)).toHaveLength(10);
    expect(page?.content).toContain(`\`${firstSubcategoryId}\`. **Test Quero List Sub 0**`);
    expect(page?.hasNext).toBe(true);
    expect(page?.totalPages).toBe(2);
    expect(page?.photoUrl).toBe('https://example.com/first-banner.png');
  });

  test("page 1 lists the remaining 2 and keeps the same banner as page 0", async () => {
    const page = await renderPage(1, authorId, 'telegram');
    expect(page?.content.match(/`\d+`\. \*\*/g)).toHaveLength(2);
    expect(page?.hasNext).toBe(false);
    expect(page?.photoUrl).toBe('https://example.com/first-banner.png');
  });
});

describe("/quero list without a banner", () => {
  const fx = new TestFixtures();
  const authorId = `test-quero-list-nobanner-${Date.now()}`;
  let userId: number;

  beforeAll(async () => {
    userId = (await fx.user({ displayName: "Test Quero List No Banner", platform: 'telegram', platformId: authorId })).id;
    const categoryId = (await fx.category({ name: `Test Quero List No Banner Category ${Date.now()}` })).id;
    const sub = await fx.subcategory({ categoryId, name: "Nome*Estranho" });
    await CardsDB.addToGoals(userId, sub.id);

    fx.onCleanup(async () => { await db.delete(subcategoryGoals).where(eq(subcategoryGoals.userId, userId)); });
  });

  afterAll(() => fx.cleanup());

  test("omits the photo when the collection has no banner, and escapes markdown in the name", async () => {
    const page = await renderPage(0, authorId, 'telegram');
    expect(page?.photoUrl).toBeUndefined();
    expect(page?.content).toContain('Nome\\*Estranho');
  });
});
