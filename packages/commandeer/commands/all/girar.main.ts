import { Command, Subcommand } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { GachaLogic } from '@girae/database/gacha'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, buildInteractiveButtons } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'
import { addHours, formatDistanceToNow, startOfHour } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { claimGirar, getGirarActive, updateGirarStep, releaseGirar } from '../../services/girarClaim'
import { renderBulkDrawSummary } from '../../services/bulkDrawSummary'

function outOfDrawsMessage(): string {
  const nextRegen = startOfHour(addHours(new Date(), 1));
  const timeUntil = formatDistanceToNow(nextRegen, { locale: ptBR, addSuffix: true });
  return `Ah... sinto muito, mas você já girou os cards que podia por agora. 😣\nVocê receberá mais giros **${timeUntil}**.`;
}

const SELECTION_TIMEOUT_SECONDS = 15 * 60
const SELECTION_EXPIRED_MESSAGE = '⏱ Sua seleção expirou. Use /girar novamente.'

export default class GirarCommand extends Command {
  static override info = {
    name: 'girar',
    description: 'Tente a sorte e puxe uma carta!',
    usage: '/girar',
    aliases: ['rodar', 'rechear', 'carimbar', 'draw', 'gi', 'mirar', 'sentar', 'gozar'],
    useWorkflow: true
  }

  static CATEGORY_SELECTED_EVENT = 'categorySelected'
  static SUBCATEGORY_SELECTED_EVENT = 'subcategorySelected'
  static NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    const authorId = ctx.message.author.id;

    let claimed = await claimGirar(authorId, { workflowID: ctx.workflowIDToBeAssigned, kind: 'interactive' });
    if (!claimed) {
      const existing = await getGirarActive(authorId);
      if (existing?.kind === 'batch') {
        await reply(ctx, 'Você já está girando em lote. Aguarde a mensagem com o resumo. 🎰');
        return;
      }
      if (existing?.step) {
        await reply(ctx, { content: existing.step.content, photoUrl: existing.step.photoUrl, buttonRows: existing.step.buttons });
        return;
      }
      // existing is null: claim expired between our failed SET and this GET - retry once before giving up.
      claimed = await claimGirar(authorId, { workflowID: ctx.workflowIDToBeAssigned, kind: 'interactive' });
      if (!claimed) return;
    }

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id);
    if (!user) {
      await releaseGirar(authorId);
      return;
    }

    if (user.usedDraws >= user.maxDraws) {
      await reply(ctx, outOfDrawsMessage());
      await releaseGirar(authorId);
      return;
    }

    try {
      const categories = (await CardsDB.getCategories())
        .filter(c => !c.isHidden)
        .sort((a, b) => a.id - b.id)
      const remainingDraws = user.maxDraws - user.usedDraws
      const categoryOptions = categories.map(c => ({ title: `${c.emoji} ${c.name}`, data: c.id }))
      const categoryRows = Array(Math.ceil(categories.length / 2)).fill(2)
      const categoryContent = `🎲 Olá, **${mention(ctx.message.platform, ctx.message.author.id, ctx.message.author.name)}**! Bem-vindo de volta. Pronto para girar?\n🎨 Você tem **${remainingDraws}** de **${user.maxDraws}** giros restantes.\n\n🕹 Escolha uma categoria:`

      await reply(ctx, {
        content: categoryContent,
        eventName: GirarCommand.CATEGORY_SELECTED_EVENT,
        restricted: 'author',
        options: categoryOptions,
        rows: categoryRows,
      })
      await updateGirarStep(authorId, ctx.workflowIDToBeAssigned, {
        content: categoryContent,
        buttons: buildInteractiveButtons(ctx.workflowIDToBeAssigned, GirarCommand.CATEGORY_SELECTED_EVENT, categoryOptions, categoryRows),
      })

      const categorySelection = await DBOS.recv<{ value: number, messageId?: string }>(GirarCommand.CATEGORY_SELECTED_EVENT, SELECTION_TIMEOUT_SECONDS)
      if (!categorySelection?.value) {
        await reply(ctx, SELECTION_EXPIRED_MESSAGE)
        return
      }
      const categoryId = categorySelection.value
      let messageId = categorySelection.messageId

      const category = await CardsDB.getCategory(categoryId);
      if (!category) return;

      const allSubcategories = await GachaLogic.getSubcategoriesForDraw(categoryId);
      const selectedSubcategories = GachaLogic.selectSubcategories(
        allSubcategories,
        category.subcategoriesOnDraw,
        user.luckModifier
      );

      if (selectedSubcategories.length === 0) {
        await reply(ctx, "Nenhuma subcategoria disponível nesta categoria!");
        return;
      }

      const subcategoryList = selectedSubcategories
        .map((c, i) => `${GirarCommand.NUMBER_EMOJIS[i] ?? `${i + 1}.`} — **${escapeMarkdown(c.name)}**`)
        .join('\n')

      const subcategoryOptions = selectedSubcategories.map((c, i) => ({ title: GirarCommand.NUMBER_EMOJIS[i] ?? `${i + 1}.`, data: c.id }))
      const subcategoryRows = Array(Math.ceil(selectedSubcategories.length / 2)).fill(2)
      const subcategoryContent = `🎰 Escolha uma coleção de **${escapeMarkdown(category.name)}**:\n\n${subcategoryList}`

      await reply(ctx, {
        content: subcategoryContent,
        eventName: GirarCommand.SUBCATEGORY_SELECTED_EVENT,
        restricted: 'author',
        options: subcategoryOptions,
        rows: subcategoryRows,
        editMessageId: messageId,
      })
      await updateGirarStep(authorId, ctx.workflowIDToBeAssigned, {
        content: subcategoryContent,
        buttons: buildInteractiveButtons(ctx.workflowIDToBeAssigned, GirarCommand.SUBCATEGORY_SELECTED_EVENT, subcategoryOptions, subcategoryRows),
      })

      await UsersDB.incrementUsedDraws(user.id)

      const subcategorySelection = await DBOS.recv<{ value: number, messageId?: string }>(GirarCommand.SUBCATEGORY_SELECTED_EVENT, SELECTION_TIMEOUT_SECONDS)
      if (!subcategorySelection?.value) {
        await reply(ctx, SELECTION_EXPIRED_MESSAGE)
        return
      }
      const subcategoryId = subcategorySelection.value
      messageId = subcategorySelection.messageId ?? messageId

      const cardPool = await GachaLogic.getCardsForDraw(subcategoryId);
      const drawnCard = GachaLogic.selectCard(cardPool);

      if (!drawnCard) {
        await reply(ctx, "Não tinha nenhum card nessa categoria... menos um giro pra você...");
        return;
      }

      // TODO: could these be a single function call inside a transaction for better performance and stability?
      const userCard = await CardsDB.addUserCard(user.id, drawnCard.id);
      await CardsDB.addCardDrawHistory(user.id, drawnCard.id, categoryId, subcategoryId);
      const tags = await CardsDB.getSecondarySubcategoryNames(drawnCard.id);

      const subcategory = allSubcategories.find(s => s.id === subcategoryId);
      const subcategoryName = subcategory?.name ?? 'Desconhecida';
      const count = userCard?.count ?? 1;
      const subcategoryNames = [subcategoryName, ...tags].map(escapeMarkdown).join(' / ');

      const text = `🎰 Parabéns, você ganhou e vai levar:

${drawnCard.rarityEmoji} \`${drawnCard.id}\`. **${escapeMarkdown(drawnCard.name)}**
${category.emoji} _${subcategoryNames}_

👾 \`${user.id}\`. ${mention(ctx.message.platform, ctx.message.author.id, ctx.message.author.name)} (\`${count}x\`)`;

      await reply(ctx, {
        content: text,
        photoUrl: drawnCard.imageUrl ?? 'https://placehold.co/600x400/png',
        editMessageId: messageId,
      });
    } finally {
      await releaseGirar(authorId);
    }
  }

  @Subcommand({ name: '*', description: 'Gasta todos os giros restantes, sem critério algum' })
  static async all(ctx: IncomingCommand) {
    const authorId = ctx.message.author.id;
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', authorId);
    if (!user) return;

    if (user.usedDraws >= user.maxDraws) {
      await reply(ctx, outOfDrawsMessage());
      return;
    }

    const claimed = await claimGirar(authorId, { workflowID: ctx.workflowIDToBeAssigned, kind: 'batch' });
    if (!claimed) {
      await reply(ctx, 'Você já está girando. Aguarde a mensagem com o resultado. 🎰');
      return;
    }

    try {
      const drawCount = user.maxDraws - user.usedDraws;
      const categories = (await CardsDB.getCategories()).filter(c => !c.isHidden);
      if (categories.length === 0) {
        await reply(ctx, 'Não há categorias disponíveis para girar no momento.');
        return;
      }

      const categoryOrder = Array.from({ length: drawCount }, () => categories[Math.floor(Math.random() * categories.length)]!.id);
      const results = await GachaLogic.runBulkDraws(user.id, categoryOrder, user.luckModifier);
      await reply(ctx, await renderBulkDrawSummary(results, { splitFavorites: false }));
    } finally {
      await releaseGirar(authorId);
    }
  }
}
