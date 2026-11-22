import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures, lastReply } from "@girae/tests";
import { EconomyDB } from "@girae/database/economy";
import { VanitiesDB } from "@girae/database/vanities";
import BackgroundCommand from "../../commands/vanity/bg";

const { sentMessages } = mockTelegram();

describe("/bg shows the inflation-adjusted price for a single item", () => {
  const fx = new TestFixtures();
  let originalInflationRate: number;
  let itemId: number;
  const authorId = 'test-bg-author';

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    originalInflationRate = await EconomyDB.getInflationRate();
    await EconomyDB.setInflationRate(1.5);
    itemId = (await fx.storeItem({ title: `Test BG Item ${Date.now()}`, type: 'background', price: 100 })).id;
  });

  afterAll(async () => {
    await EconomyDB.setInflationRate(originalInflationRate);
    await fx.cleanup();
  });

  test("viewing a specific item by ID shows price * inflationRate, not the raw base price", async () => {
    const resolvedItem = await VanitiesDB.getStoreItemById(itemId);
    sentMessages.length = 0;

    await BackgroundCommand.execute(fakeCtx({ name: 'bg', authorId, platform: 'telegram', args: [String(itemId)] }), { item: resolvedItem as any });
    const last = await lastReply(sentMessages);
    const text = last.text ?? last.caption ?? '';
    expect(text).toContain('150 moedas');
    expect(text).not.toContain('100 moedas');
  });
});
