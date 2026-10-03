import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { CardsDB } from "@girae/database/cards";
import { db } from "@girae/database/index";
import { userCards, rarities } from "@girae/database/schemas/cards";
import { users } from "@girae/database/schemas/users";
import { CARD_DISCARD_REWARDS } from "@girae/database/constants";
import { eq, and } from "drizzle-orm";
import DelClcCommand from "../../commands/cards/delclc";

const { sentMessages } = mockTelegram();

describe("/delclc discards every card a user owns in a collection for coins", () => {
  const fx = new TestFixtures();
  const userPlatformId = "test-delclc-user";
  let userId: number;
  let subcategoryId: number, otherSubcategoryId: number, emptySubcategoryId: number;
  let cardAId: number, cardBId: number, otherCardId: number;

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    userId = (await fx.user({ displayName: "Test DelClc User", platform: 'telegram', platformId: userPlatformId })).id;

    const [comum] = await db.select().from(rarities).where(eq(rarities.name, "Comum")).limit(1);

    const categoryId = (await fx.category({ name: `Test DelClc Category ${Date.now()}` })).id;
    subcategoryId = (await fx.subcategory({ categoryId, name: `Test DelClc Sub ${Date.now()}` })).id;
    otherSubcategoryId = (await fx.subcategory({ categoryId, name: `Test DelClc Other Sub ${Date.now()}` })).id;
    // dedicated "owns nothing here" fixture, since otherSubcategoryId deliberately isn't empty
    emptySubcategoryId = (await fx.subcategory({ categoryId, name: `Test DelClc Empty Sub ${Date.now()}` })).id;
    cardAId = (await fx.card({ name: `Test DelClc Card A ${Date.now()}`, subcategoryId, rarityId: comum!.id })).id;
    cardBId = (await fx.card({ name: `Test DelClc Card B ${Date.now()}`, subcategoryId, rarityId: comum!.id })).id;
    otherCardId = (await fx.card({ name: `Test DelClc Other Card ${Date.now()}`, subcategoryId: otherSubcategoryId })).id;
    await fx.card({ name: `Test DelClc Empty Sub Card ${Date.now()}`, subcategoryId: emptySubcategoryId });

    fx.onCleanup(async () => {
      await db.delete(userCards).where(eq(userCards.userId, userId));
    });
  });

  afterAll(() => fx.cleanup());

  function runCtx(args: string[], workflowID: string) {
    return fakeCtx({ name: 'delclc', authorId: userPlatformId, args, platform: 'telegram', workflowID });
  }

  async function ownedCount(cardId: number): Promise<number> {
    const row = await db.select().from(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId))).then(r => r[0]);
    return row?.count ?? 0;
  }

  async function coins(): Promise<number> {
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    return row!.coins;
  }

  async function runToConfirm(subcategoryArg: string) {
    const workflowID = `test-delclc-${Bun.randomUUIDv7()}`;
    const ctx = runCtx([subcategoryArg], workflowID);
    const subcategory = await CardsDB.getSubcategory(parseInt(subcategoryArg, 10));
    const handle = await DBOS.startWorkflow(DelClcCommand, { workflowID }).execute(ctx, { subcategory: subcategory! });
    await new Promise(r => setTimeout(r, 500));
    return { workflowID, handle };
  }

  test("discards every owned card in the collection and credits the coins, ignoring other collections", async () => {
    await fx.ownCard(userId, cardAId, 2);
    await fx.ownCard(userId, cardBId, 1);
    await fx.ownCard(userId, otherCardId, 1);
    const coinsBefore = await coins();

    const startIndex = sentMessages.length;
    const { workflowID, handle } = await runToConfirm(String(subcategoryId));

    const confirmPrompt = sentMessages.slice(startIndex).find(m => typeof m.text === 'string' && m.text.includes('Descartar toda'));
    expect(confirmPrompt).toBeDefined();
    expect(confirmPrompt!.text).toInclude('<strong>3</strong> carta(s)');

    await DBOS.send(workflowID, { value: true }, 'delclc:confirm');
    await handle.getResult();

    expect(await ownedCount(cardAId)).toBe(0);
    expect(await ownedCount(cardBId)).toBe(0);
    expect(await ownedCount(otherCardId)).toBe(1);
    expect(await coins()).toBe(coinsBefore + CARD_DISCARD_REWARDS.Comum! * 3);
  });

  test("cancelling leaves every card and the coin balance untouched", async () => {
    await fx.ownCard(userId, cardAId, 1);
    const coinsBefore = await coins();
    const { workflowID, handle } = await runToConfirm(String(subcategoryId));
    await DBOS.send(workflowID, { value: false }, 'delclc:confirm');
    await handle.getResult();

    expect(await ownedCount(cardAId)).toBe(1);
    expect(await coins()).toBe(coinsBefore);
  });

  test("owning nothing in the collection resolves without throwing and prompts no confirmation", async () => {
    const workflowID = `test-delclc-empty-${Bun.randomUUIDv7()}`;
    const ctx = runCtx([String(emptySubcategoryId)], workflowID);
    const subcategory = await CardsDB.getSubcategory(emptySubcategoryId);
    const handle = await DBOS.startWorkflow(DelClcCommand, { workflowID }).execute(ctx, { subcategory: subcategory! });
    await new Promise(r => setTimeout(r, 500));
    let threw: unknown;
    try { await handle.getResult() } catch (e) { threw = e }
    expect(threw).toBeUndefined();
  });

  test("a TOCTOU race: the user loses a card between the confirm prompt and the click", async () => {
    await fx.ownCard(userId, cardAId, 1);
    await fx.ownCard(userId, cardBId, 1);
    const cardBCountBefore = await ownedCount(cardBId);
    const coinsBefore = await coins();
    const { workflowID, handle } = await runToConfirm(String(subcategoryId));

    await db.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardAId)));

    await DBOS.send(workflowID, { value: true }, 'delclc:confirm');
    await handle.getResult();

    // the whole discard aborts - the still-owned card B must not have been touched either
    expect(await ownedCount(cardBId)).toBe(cardBCountBefore);
    expect(await coins()).toBe(coinsBefore);
  });
});
