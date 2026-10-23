import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures } from "@girae/tests";
import CativeirosCommand, { renderPage } from "../../commands/cards/cativeiros";

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
    await CativeirosCommand.execute(ctx);
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
      const page = await renderPage(String(viewerId), 0, 'telegram');
      expect(page?.content).toContain(`👤 \`${viewerId}\`. Cativeiros de **Test Cativeiros**`);
      expect(page?.content).toContain('Use `/upload id`.');
      expect(page?.content).not.toContain('quotando um vídeo/foto');
      expect(page?.content).not.toContain('/emojicard');
    });

    test("singular wording with exactly one eligible card", async () => {
      const page = await renderPage(String(viewerId), 0, 'telegram');
      expect(page?.content).toContain('👑 `1` cativeiro ativo.');
      expect(page?.content).not.toContain('cativeiros ativos');
    });

    test("plural wording once a second card becomes eligible", async () => {
      const secondRarityId = (await fx.rarity({ name: "Test Cativeiros Rarity 2", emoji: '🥈', cativeiroThreshold: 5 })).id;
      const secondCardId = (await fx.card({ name: "Kero", rarityId: secondRarityId })).id;
      await fx.ownCard(viewerId, secondCardId, 5);

      const page = await renderPage(String(viewerId), 0, 'telegram');
      expect(page?.content).toContain('👑 `2` cativeiros ativos.');
    });

    test("shows the rarity emoji when no custom emoji is set", async () => {
      const page = await renderPage(String(viewerId), 0, 'telegram');
      expect(page?.content).toContain(`🥇 \`${cardId}\`. **Clow Reed** \`5x\``);
    });

    test("a custom emoji replaces the rarity emoji in the row, not appended alongside it", async () => {
      const { CardsDB } = await import("@girae/database/cards");
      await CardsDB.setUserCardCustomEmoji(viewerId, cardId, '💎');

      const page = await renderPage(String(viewerId), 0, 'telegram');
      expect(page?.content).toContain(`💎 \`${cardId}\`. **Clow Reed** \`5x\``);
      expect(page?.content).not.toContain('🥇');
    });

    test("appends the card's main subcategory name in italics when it has one", async () => {
      const category = await fx.category({ name: "Test Cativeiros Category" });
      const subcategory = await fx.subcategory({ categoryId: category.id, name: "CLAMP" });
      const taggedRarityId = (await fx.rarity({ name: "Test Cativeiros Rarity 3", emoji: '🥉', cativeiroThreshold: 5 })).id;
      const taggedCardId = (await fx.card({ name: "Sakura", rarityId: taggedRarityId, subcategoryId: subcategory.id })).id;
      await fx.ownCard(viewerId, taggedCardId, 5);

      const page = await renderPage(String(viewerId), 0, 'telegram');
      expect(page?.content).toContain(`🥉 \`${taggedCardId}\`. **Sakura** \`5x\` ✨ — _CLAMP_`);
    });
  });
});
