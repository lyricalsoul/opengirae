import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, TestFixtures } from "@girae/tests";
import CativeiroNotifyHook from "../../hooks/cativeiroNotify";

mockTelegram();

// reply()'s job still round-trips through the real BullMQ queue even for platform
// 'none' (the answerer just no-ops it) - a live worker is required for the await to
// resolve at all. Content assertions are deliberately avoided (see docs/agent/03-commands.md's
// testing section on why mockTelegram()'s captured array can lag); these only prove the
// hook never throws across the shapes it can be called with.
describe("CativeiroNotifyHook.onCardsNew", () => {
  const fx = new TestFixtures();
  let cardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");
    const rarityId = (await fx.rarity({ name: "Test Hook Rarity", cativeiroThreshold: 5 })).id;
    cardId = (await fx.card({ name: "Test Hook Card", rarityId })).id;
  });

  afterAll(() => fx.cleanup());

  const baseEvent = () => ({
    userId: 1, cardId, telegramId: `test-hook-${Bun.randomUUIDv7()}`, displayName: "Test Hook User", platform: 'none' as const,
  });

  test("a crossing (previousCount below, newCount at/above threshold) resolves without throwing", async () => {
    await expect(CativeiroNotifyHook.onCardsNew({ ...baseEvent(), previousCount: 4, newCount: 5 })).resolves.toBeUndefined();
  });

  test("no crossing (already past threshold before this gain) resolves without throwing", async () => {
    await expect(CativeiroNotifyHook.onCardsNew({ ...baseEvent(), previousCount: 5, newCount: 6 })).resolves.toBeUndefined();
  });

  test("not yet reaching the threshold resolves without throwing", async () => {
    await expect(CativeiroNotifyHook.onCardsNew({ ...baseEvent(), previousCount: 2, newCount: 3 })).resolves.toBeUndefined();
  });

  test("a nonexistent cardId is handled gracefully", async () => {
    await expect(CativeiroNotifyHook.onCardsNew({ ...baseEvent(), cardId: 999999999, previousCount: 4, newCount: 5 })).resolves.toBeUndefined();
  });
});
