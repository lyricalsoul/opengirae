import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { subcategoryGoals } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import { CardsDB } from "@girae/database/cards";
import QueroCommand from "../../commands/all/quero.cards";

// answerer's `worker` is a process-wide singleton - mock unconditionally so this file can't win the race and leave others talking to real Telegram.
mockTelegram();

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
