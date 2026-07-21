import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram } from "@girae/tests";
import { db } from "@girae/database/index";
import { users, linkedAccounts } from "@girae/database/schemas/users";
import { categories, subcategories, subcategoryGoals } from "@girae/database/schemas/cards";
import { CardsDB } from "@girae/database/cards";
import { eq, inArray } from "drizzle-orm";
import type { IncomingCommand } from "@girae/common/commands/types";
import QueroCommand from "../../commands/all/quero.cards";

// answerer's `worker` is a process-wide singleton - mock unconditionally so this file can't win the race and leave others talking to real Telegram.
mockTelegram();

// Regression: multi-word names (the normal case) fell through to bulk-ID mode and choked on the first word.
describe("/quero multi-word name resolution", () => {
  let userId: number;
  let categoryId: number;
  let subcategoryId: number;

  beforeAll(async () => {
    // reply() blocks on job.waitUntilFinished() - needs a real worker consuming the queue.
    await import("@girae/answerer/index");

    const [user] = await db.insert(users).values({ displayName: "Test Quero", avatarUrl: "" }).returning();
    userId = user!.id;
    await db.insert(linkedAccounts).values({ userId, platform: 'none', platformId: 'test-quero-author' });

    const [category] = await db.insert(categories).values({ name: "Test Quero Category", emoji: "🧪" }).returning();
    categoryId = category!.id;

    const [subcategory] = await db.insert(subcategories).values({ categoryId, name: "Zzzyx Multiword Test Collection" }).returning();
    subcategoryId = subcategory!.id;
  });

  afterAll(async () => {
    await db.delete(subcategoryGoals).where(eq(subcategoryGoals.userId, userId));
    await db.delete(subcategories).where(eq(subcategories.id, subcategoryId));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  function ctxFor(args: string[]): IncomingCommand {
    return {
      name: 'quero',
      args,
      workflowIDToBeAssigned: `test-quero-${Date.now()}`,
      message: {
        id: 'msg-1',
        author: { id: 'test-quero-author', name: 'Tester', avatarUrl: '' },
        chat: { id: 'chat-1', title: 'test' },
        content: `/quero ${args.join(' ')}`,
        timestamp: new Date(),
        platform: 'none',
      },
    };
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
