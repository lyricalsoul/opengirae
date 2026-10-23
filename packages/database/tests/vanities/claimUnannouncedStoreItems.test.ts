import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, futureCutoff } from "@girae/tests";
import { VanitiesDB } from "../../vanities";

describe("VanitiesDB.claimUnannouncedStoreItems", () => {
  const fx = new TestFixtures();

  afterAll(() => fx.cleanup());

  // onlyIds scopes every claim below to just this test's own fixtures - the underlying UPDATE is otherwise table-wide.

  test("claims a new item, stamping announcedAt with the given schedTime, but only once", async () => {
    const itemId = (await fx.storeItem({ title: `Test Claim BG ${Date.now()}`, type: 'background' })).id;
    const cutoff = futureCutoff();
    const schedTime = new Date();

    const firstRun = await VanitiesDB.claimUnannouncedStoreItems('background', schedTime, cutoff, [itemId]);
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0]?.id).toBe(itemId);

    const batch = await VanitiesDB.getStoreItemsForAnnouncementBatch('background', schedTime);
    expect(batch.map(i => i.id)).toContain(itemId);

    const secondRun = await VanitiesDB.claimUnannouncedStoreItems('background', schedTime, cutoff, [itemId]);
    expect(secondRun).toHaveLength(0);
  });

  test("an item younger than cutoff is not claimed", async () => {
    const itemId = (await fx.storeItem({ title: `Test Claim BG Fresh ${Date.now()}`, type: 'background' })).id;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const claimed = await VanitiesDB.claimUnannouncedStoreItems('background', new Date(), oneHourAgo, [itemId]);
    expect(claimed).toHaveLength(0);
  });

  test("claiming one type does not claim an item of the other type", async () => {
    const stickerId = (await fx.storeItem({ title: `Test Claim Sticker ${Date.now()}`, type: 'sticker' })).id;
    const cutoff = futureCutoff();

    const claimedAsBackground = await VanitiesDB.claimUnannouncedStoreItems('background', new Date(), cutoff, [stickerId]);
    expect(claimedAsBackground).toHaveLength(0);

    const claimedAsSticker = await VanitiesDB.claimUnannouncedStoreItems('sticker', new Date(), cutoff, [stickerId]);
    expect(claimedAsSticker).toHaveLength(1);
  });
});
