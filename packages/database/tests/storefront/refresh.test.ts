import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, seedStorefront } from "@girae/tests";
import { StorefrontDB } from "../../storefront";

describe("StorefrontDB.getState", () => {
  const fx = new TestFixtures();
  let seeded: Awaited<ReturnType<typeof seedStorefront>>;

  beforeAll(async () => { seeded = await seedStorefront(fx); });
  afterAll(() => fx.cleanup());

  test("reads the singleton storefront row", async () => {
    const state = await StorefrontDB.getState();
    expect(state.id).toBe(seeded.id);
    expect(state.cardIds).toEqual(seeded.cardIds);
  });
});
