import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users, userProfiles } from "@girae/database/schemas/users";
import { userCards } from "@girae/database/schemas/cards";
import { eq } from "drizzle-orm";
import RankCommand from "../../commands/users/rank";

const { sentMessages } = mockTelegram();

async function waitForSentMessage(minLength: number, timeoutMs = 5000): Promise<void> {
  const startTime = Date.now();
  while (sentMessages.length < minLength) {
    if (Date.now() - startTime > timeoutMs) throw new Error(`Timeout waiting for sentMessages.length >= ${minLength}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

describe("/rank", () => {
  const fx = new TestFixtures();
  let highId: number, highPlatformId: string, privatePlatformId: string, privateId: number, cardId: number, maiscatId: number, maiscatPlatformId: string;

  beforeAll(async () => {
    await bootstrapCommandeerWorkers();

    highPlatformId = `test-rank-cmd-high-${Date.now()}`;
    const high = await fx.user({ displayName: "Rank High", platform: "telegram", platformId: highPlatformId });
    highId = high.id;

    privatePlatformId = `test-rank-cmd-private-${Date.now()}`;
    const priv = await fx.user({ displayName: "Rank Private", platform: "telegram", platformId: privatePlatformId });
    privateId = priv.id;
    await db.update(users).set({ privacyMode: true, coins: 555555555 }).where(eq(users.id, privateId));

    await db.update(users).set({ coins: 999999999 }).where(eq(users.id, highId));
    await db.update(userProfiles).set({ reputation: 999999999 }).where(eq(userProfiles.userId, highId));

    const categoryId = (await fx.category({ name: `Test Rank Cmd Category ${Date.now()}` })).id;
    const subcategoryId = (await fx.subcategory({ categoryId, name: `Test Rank Cmd Sub ${Date.now()}` })).id;
    cardId = (await fx.card({ name: `Test Rank Cmd Card ${Date.now()}`, subcategoryId })).id;
    await db.insert(userCards).values({ userId: highId, cardId, count: 42 });
    fx.onCleanup(async () => {
      await db.delete(userCards).where(eq(userCards.userId, highId));
    });

    maiscatPlatformId = `test-rank-cmd-maiscat-${Date.now()}`;
    maiscatId = (await fx.user({ displayName: "Rank Maiscat", platform: "telegram", platformId: maiscatPlatformId })).id;
    const lowThresholdRarityId = (await fx.rarity({ name: `Test Rank Cmd Cativeiro Rarity ${Date.now()}`, cativeiroThreshold: 2 })).id;
    const maiscatCardId = (await fx.card({ name: `Test Rank Cmd Cativeiro Card ${Date.now()}`, subcategoryId, rarityId: lowThresholdRarityId })).id;
    await db.insert(userCards).values({ userId: maiscatId, cardId: maiscatCardId, count: 2 });
    fx.onCleanup(async () => {
      await db.delete(userCards).where(eq(userCards.userId, maiscatId));
    });
  });

  afterAll(() => fx.cleanup());

  test("rep page mentions the top user, bolded, with points", async () => {
    const page = await RankCommand.rankPage("rep", 0, highPlatformId, "telegram");
    expect(page).not.toBeNull();
    expect(page!.content).toContain("**Ranking de Reputação**");
    expect(page!.content).toContain(`**[Rank High](tg://user?id=${highPlatformId})**`);
    expect(page!.content).toContain("999999999 pts");
  });

  test("dinheiro page shows the viewer's own position", async () => {
    const page = await RankCommand.rankPage("dinheiro", 0, highPlatformId, "telegram");
    expect(page!.content).toContain("Você está em **#1**");
    expect(page!.content).toContain("999999999 moedas");
  });

  test("cativeiros page formats card id monospace, name italic, count monospace", async () => {
    const page = await RankCommand.rankPage("cativeiros", 0, highPlatformId, "telegram");
    expect(page!.content).toContain(`\`${cardId}\`.`);
    expect(page!.content).toContain("_Test Rank Cmd Card");
    expect(page!.content).toContain("`x42`");
  });

  test("maiscat page counts distinct eligible cards per user, not the single-card pile cativeiros ranks", async () => {
    // only checks the position line, not top-10 placement - unlike dinheiro/rep's astronomical values, 1 eligible card isn't guaranteed to rank in the top 10 on a shared dev DB.
    const page = await RankCommand.rankPage("maiscat", 0, maiscatPlatformId, "telegram");
    expect(page!.content).toContain("**Ranking de Mais Cativeiros**");
    expect(page!.content).toContain("Você está em **#");
    expect(page!.content).toContain("com 1 cativeiros");
  });

  test("a privacy-mode user shows as a plain bold name, not a mention", async () => {
    const page = await RankCommand.rankPage("dinheiro", 0, highPlatformId, "telegram");
    expect(page!.content).toContain("**Rank Private**");
    expect(page!.content).not.toContain(`tg://user?id=${privatePlatformId}`);
  });

  test("a privacy-mode user viewing their own row still gets a mention (self-exception)", async () => {
    const page = await RankCommand.rankPage("dinheiro", 0, privatePlatformId, "telegram");
    expect(page!.content).toContain(`tg://user?id=${privatePlatformId}`);
  });

  test("no matching card leads to an empty-state message, not a crash", async () => {
    const emptyPlatformId = `test-rank-cmd-empty-${Date.now()}`;
    const page = await RankCommand.rankPage("cativeiros", 9999, emptyPlatformId, "telegram");
    expect(page).toBeNull();
  });

  test("dispatching through the subcommand reaches the reply queue", async () => {
    const startIndex = sentMessages.length;
    const ctx = fakeCtx({ name: "rank", authorId: highPlatformId, platform: "telegram", chatId: "chat-1" });
    await RankCommand.rep(ctx);
    await waitForSentMessage(startIndex + 1);

    const msg = sentMessages[sentMessages.length - 1]!;
    const content = msg.text ?? msg.content ?? "";
    expect(content).toContain("Ranking de Reputação");
  });
});
