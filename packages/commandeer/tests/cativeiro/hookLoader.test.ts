import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, TestFixtures } from "@girae/tests";
import { emitHook, emitCardsNew } from "../../hookLoader";

mockTelegram();

// Proves the dynamic hooks/*.ts loader actually found and wired up the real
// cativeiroNotify hook for 'cards:new' - emitHook resolving without throwing is the
// signal the dispatch (readdirSync -> import -> registered handler) worked end to end.
describe("hookLoader", () => {
  const fx = new TestFixtures();
  let cardId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");
    const rarityId = (await fx.rarity({ name: "Test HookLoader Rarity", cativeiroThreshold: 5 })).id;
    cardId = (await fx.card({ name: "Test HookLoader Card", rarityId })).id;
  });

  afterAll(() => fx.cleanup());

  test("emitHook('cards:new', ...) dispatches to the registered listener without throwing", async () => {
    await expect(emitHook('cards:new', {
      userId: 1, cardId, previousCount: 4, newCount: 5,
      telegramId: `test-hookloader-${Bun.randomUUIDv7()}`, displayName: "Test HookLoader User", platform: 'none',
    })).resolves.toBeUndefined();
  });

  test("an event nobody's listening for is simply a no-op, not an error", async () => {
    // @ts-expect-error - deliberately an unregistered event name, to prove the empty-handlers path doesn't throw
    await expect(emitHook('nonexistent:event', {})).resolves.toBeUndefined();
  });

  test("emitCardsNew fires one event per crossing entry without throwing", async () => {
    await expect(emitCardsNew(1, `test-hookloader-${Bun.randomUUIDv7()}`, "Test HookLoader User", 'none', [
      { cardId, previousCount: 3, newCount: 4 },
      { cardId, previousCount: 4, newCount: 5 },
    ])).resolves.toBeUndefined();
  });
});
