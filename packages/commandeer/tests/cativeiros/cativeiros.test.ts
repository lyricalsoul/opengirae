import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import CativeirosCommand, { renderPage } from "../../commands/all/cativeiros.cards";

mockTelegram();

describe("/cativeiros", () => {
  const fx = new TestFixtures();
  let authorId: string;
  let viewerId: number;

  beforeAll(async () => {
    await import("@girae/answerer/index");
    authorId = `test-cativeiros-${Bun.randomUUIDv7()}`;
    viewerId = (await fx.user({ displayName: "Test Cativeiros", platform: 'none', platformId: authorId })).id;
  });

  afterAll(() => fx.cleanup());

  test("with no eligible cards, execute() resolves without throwing", async () => {
    const ctx = fakeCtx({ name: 'cativeiros', authorId, platform: 'none' });
    await expect(CativeirosCommand.execute(ctx)).resolves.toBeUndefined();
  });

  describe("renderPage content", () => {
    let rarityId: number;
    let cardId: number;

    beforeAll(async () => {
      rarityId = (await fx.rarity({ name: "Test Cativeiros Rarity", emoji: '🥇', cativeiroThreshold: 5 })).id;
      cardId = (await fx.card({ name: "Clow Reed", rarityId })).id;
      await fx.ownCard(viewerId, cardId, 5);
    });

    test("no tutorial text, just the list and a short 'Use /upload id.' footer", async () => {
      const page = await renderPage(String(viewerId), 0);
      expect(page?.content).toContain(`👤 \`${viewerId}\`. Cativeiros de **Test Cativeiros**`);
      expect(page?.content).toContain('Use `/upload id`.');
      expect(page?.content).not.toContain('quotando um vídeo/foto');
      expect(page?.content).not.toContain('/emojicard');
    });

    test("shows the rarity emoji when no custom emoji is set", async () => {
      const page = await renderPage(String(viewerId), 0);
      expect(page?.content).toContain(`🥇 \`${cardId}\`. **Clow Reed** (\`5x\`)`);
    });

    test("a custom emoji replaces the rarity emoji in the row, not appended alongside it", async () => {
      const { CardsDB } = await import("@girae/database/cards");
      await CardsDB.setUserCardCustomEmoji(viewerId, cardId, '💎');

      const page = await renderPage(String(viewerId), 0);
      expect(page?.content).toContain(`💎 \`${cardId}\`. **Clow Reed** (\`5x\`)`);
      expect(page?.content).not.toContain('🥇');
    });
  });
});
