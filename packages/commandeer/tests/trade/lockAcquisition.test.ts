import { test, expect, describe, afterAll } from "bun:test";
import { rawClient } from "@girae/common/queue";

// trade.cards.ts guards "already in a trade" by acquiring `trade:lock:{telegramId}`
// via `SET ... NX`, not a GET-then-SET check. This proves the atomicity that fix
// depends on: two callers racing to acquire the same key must never both win. A
// GET-then-SET version of this same test would flake exactly the bug that was fixed
// (both callers observing "no lock" before either writes one).
describe("trade lock acquisition race", () => {
  const testKey = `test:trade:lock:${Date.now()}`;

  afterAll(async () => {
    await rawClient.del(testKey);
  });

  async function tryAcquire(value: string): Promise<boolean> {
    const result = await rawClient.set(testKey, value, { EX: 60, NX: true });
    return result === 'OK';
  }

  test("only one of many concurrent acquisitions on the same key succeeds", async () => {
    const attempts = 20;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) => tryAcquire(`attempt-${i}`))
    );

    const wins = results.filter(Boolean).length;
    expect(wins).toBe(1); // never 0 (the lock is acquirable), never >1 (no double-booking)
  });

  test("a released lock can be re-acquired", async () => {
    await rawClient.del(testKey);
    expect(await tryAcquire('first')).toBe(true);
    expect(await tryAcquire('second')).toBe(false); // still held

    await rawClient.del(testKey);
    expect(await tryAcquire('third')).toBe(true); // free again after release
  });
});
