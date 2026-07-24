import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures } from "@girae/tests";
import { EconomyDB } from "@girae/database/economy";
import { renderVanityBrowsePage } from "../../services/vanity/vanityBrowser";

describe("renderVanityBrowsePage shows inflation-adjusted prices", () => {
  const fx = new TestFixtures();
  let originalInflationRate: number;

  beforeAll(async () => {
    originalInflationRate = await EconomyDB.getInflationRate();
    await EconomyDB.setInflationRate(2);
    await fx.storeItem({ title: `Test Browse Item ${Date.now()}`, type: 'background', price: 100 });
  });

  afterAll(async () => {
    await EconomyDB.setInflationRate(originalInflationRate);
    await fx.cleanup();
  });

  test("the rendered list shows price * inflationRate, not the raw base price", async () => {
    const page = await renderVanityBrowsePage('background', 0, 'nonexistent-viewer', 'telegram');
    expect(page.content).toContain('200 moedas');
    expect(page.content).not.toContain('100 moedas');
  });
});
