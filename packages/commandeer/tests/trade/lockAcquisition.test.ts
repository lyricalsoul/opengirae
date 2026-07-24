import { test, expect, describe, afterAll } from "bun:test";
import { rawClient } from "@girae/common/queue";
import { tryAcquireLock, lockKey } from "../../services/cards/tradeLock";

// exercises the real tradeLock.ts (SET NX, not GET-then-SET) trade.cards.ts uses to guard "already in a trade"
describe("trade lock acquisition race", () => {
  const telegramId = `test-trade-lock-${Date.now()}`;

  afterAll(async () => {
    await rawClient.del(lockKey(telegramId));
  });

  test("only one of many concurrent acquisitions on the same telegram id succeeds", async () => {
    const attempts = 20;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        tryAcquireLock(telegramId, { workflowID: `wf-${i}`, partnerId: 'partner' }))
    );

    const wins = results.filter(Boolean).length;
    expect(wins).toBe(1); // never 0 (the lock is acquirable), never >1 (no double-booking)
  });

  test("a released lock can be re-acquired", async () => {
    await rawClient.del(lockKey(telegramId));
    expect(await tryAcquireLock(telegramId, { workflowID: 'wf-first', partnerId: 'partner' })).toBe(true);
    expect(await tryAcquireLock(telegramId, { workflowID: 'wf-second', partnerId: 'partner' })).toBe(false); // still held

    await rawClient.del(lockKey(telegramId));
    expect(await tryAcquireLock(telegramId, { workflowID: 'wf-third', partnerId: 'partner' })).toBe(true); // free again after release
  });
});
