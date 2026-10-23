import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, fakeCtx, mockTelegram, bootstrapCommandeerWorkers } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { CardsDB } from "@girae/database/cards";
import ClearWishlistCommand from "../../commands/cards/cwl";

mockTelegram();

describe("/cwl", () => {
  const fx = new TestFixtures();
  const platformId = `test-cwl-${Date.now()}`;
  let userId: number;
  let cardAId: number, cardBId: number;

  beforeAll(async () => {
    await bootstrapCommandeerWorkers();

    userId = (await fx.user({ displayName: "Test Cwl", platform: 'telegram', platformId })).id;
    cardAId = (await fx.card({ name: `Test Cwl Card A ${Date.now()}` })).id;
    cardBId = (await fx.card({ name: `Test Cwl Card B ${Date.now()}` })).id;
  });

  afterAll(() => fx.cleanup());

  test("removes a single card by fuzzy name", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    const ctx = fakeCtx({ name: 'cwl', authorId: platformId, platform: 'telegram' });
    await ClearWishlistCommand.execute(ctx, { cardsRaw: 'Test Cwl Card A' });

    expect(await CardsDB.isOnWishlist(userId, cardAId)).toBe(false);
  });

  test("removes multiple cards by ID, reporting ones not on the list", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    const ctx = fakeCtx({ name: 'cwl', authorId: platformId, platform: 'telegram' });
    await ClearWishlistCommand.execute(ctx, { cardsRaw: `${cardAId} ${cardBId}` });

    expect(await CardsDB.isOnWishlist(userId, cardAId)).toBe(false);
    expect(await CardsDB.isOnWishlist(userId, cardBId)).toBe(false);
  });

  test("no args, confirmed: clears the whole wishlist", async () => {
    await CardsDB.addToWishlist(userId, cardAId);
    await CardsDB.addToWishlist(userId, cardBId);

    const workflowID = `test-cwl-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'cwl', authorId: platformId, platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(ClearWishlistCommand, { workflowID }).execute(ctx, { cardsRaw: undefined });
    await DBOS.send(workflowID, { value: true }, 'cwl:confirm');
    await handle.getResult();

    const { total } = await CardsDB.getWishlist(userId, {});
    expect(total).toBe(0);
  });

  test("no args, cancelled: leaves the wishlist untouched", async () => {
    await CardsDB.addToWishlist(userId, cardAId);

    const workflowID = `test-cwl-cancel-${Bun.randomUUIDv7()}`;
    const ctx = fakeCtx({ name: 'cwl', authorId: platformId, platform: 'telegram', workflowID });
    const handle = await DBOS.startWorkflow(ClearWishlistCommand, { workflowID }).execute(ctx, { cardsRaw: undefined });
    await DBOS.send(workflowID, { value: false }, 'cwl:confirm');
    await handle.getResult();

    expect(await CardsDB.isOnWishlist(userId, cardAId)).toBe(true);
    await CardsDB.removeFromWishlist(userId, cardAId);
  });

  test("no args, already empty: resolves without prompting", async () => {
    const ctx = fakeCtx({ name: 'cwl', authorId: platformId, platform: 'telegram' });
    await ClearWishlistCommand.execute(ctx, { cardsRaw: undefined });
  });
});
