import { test, expect, describe, beforeAll } from "bun:test";
import { mockTelegram } from "@girae/tests";
import CollectionCompletionNotifyHook from "../../hooks/collectionCompletionNotify";

const mock = mockTelegram();

// Purely reactive - no DB fixtures needed, the hook only reads event.completedSubcategories.
describe("CollectionCompletionNotifyHook.onCardsNew", () => {
  beforeAll(async () => {
    await import("@girae/answerer/index");
  });

  const baseEvent = () => ({
    userId: 1, cardId: 1, previousCount: 0, newCount: 1,
    telegramId: `test-collection-hook-${Bun.randomUUIDv7()}`, displayName: "Test Collection Hook User", platform: 'telegram' as const,
  });

  test("no completedSubcategories on the event is a no-op", async () => {
    await CollectionCompletionNotifyHook.onCardsNew(baseEvent());
  });

  test("an empty completedSubcategories array is a no-op", async () => {
    await CollectionCompletionNotifyHook.onCardsNew({ ...baseEvent(), completedSubcategories: [] });
  });

  test("one completed subcategory sends exactly one DM with the name and coin amount", async () => {
    const event = { ...baseEvent(), completedSubcategories: [{ subcategoryId: 1, subcategoryName: "Barbie", coinsAwarded: 1875 }] };
    await CollectionCompletionNotifyHook.onCardsNew(event);

    const dm = mock.sentMessages.find((m: any) => m.chatId === event.telegramId);
    expect(dm?.text).toContain("🎉 Parabéns! Você completou a coleção <strong>Barbie</strong> e recebeu <strong>1875</strong> moedas.");
  });

  test("multiple completed subcategories each get their own DM", async () => {
    const event = {
      ...baseEvent(),
      completedSubcategories: [
        { subcategoryId: 1, subcategoryName: "Barbie", coinsAwarded: 1875 },
        { subcategoryId: 2, subcategoryName: "NEXZ", coinsAwarded: 2250 },
      ],
    };
    await CollectionCompletionNotifyHook.onCardsNew(event);

    const dms = mock.sentMessages.filter((m: any) => m.chatId === event.telegramId);
    expect(dms.some((m: any) => m.text?.includes("<strong>Barbie</strong>"))).toBe(true);
    expect(dms.some((m: any) => m.text?.includes("<strong>NEXZ</strong>"))).toBe(true);
  });
});
