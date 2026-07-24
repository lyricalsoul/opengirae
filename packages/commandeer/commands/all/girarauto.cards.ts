import { Command, Page } from '@girae/common/commands'
import { reply, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { GachaLogic } from '@girae/database/gacha'
import type { IncomingCommand } from '@girae/common/commands/types'
import { addHours, formatDistanceToNow, startOfHour } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { claimGirar, releaseGirar } from '../../services/gacha/girarClaim'
import { buildBulkDrawSummary, renderBulkDrawSummaryPage, cacheBulkDrawSummary, loadBulkDrawSummary } from '../../services/gacha/bulkDrawSummary'
import { resolveCategoryByIdOrName } from '../../services/commandArguments'
import { emitCardsNew } from '../../loaders/hooks'

export function parseQuantity(raw: string | undefined, remaining: number): number | null {
  if (!raw) return null
  const normalized = raw.toLowerCase()
  if (normalized === '*' || normalized === 'all' || normalized === 'tudo') return remaining
  const n = parseInt(raw, 10)
  return (isNaN(n) || n <= 0) ? null : n
}

export default class GirarAutoCommand extends Command {
  static override info = {
    name: 'girarauto',
    description: 'Gira automaticamente nas categorias das suas coleções favoritas',
    usage: '/girarauto <quantidade|*|all|tudo> [categoria]',
  }

  static override async execute(ctx: IncomingCommand) {
    const authorId = ctx.message.author.id;
    const chatId = ctx.message.chat.id;
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', authorId);
    if (!user) return;

    const remaining = user.maxDraws - user.usedDraws;
    if (remaining <= 0) {
      const nextRegen = startOfHour(addHours(new Date(), 1));
      const timeUntil = formatDistanceToNow(nextRegen, { locale: ptBR, addSuffix: true });
      await reply(ctx, `Ah... sinto muito, mas você já girou os cards que podia por agora. 😣\nVocê receberá mais giros **${timeUntil}**.`);
      return;
    }

    const requested = parseQuantity(ctx.args[0], remaining);
    if (requested === null) {
      await reply(ctx, `Uso: \`${GirarAutoCommand.info.usage}\``);
      return;
    }
    const drawCount = Math.min(requested, remaining);

    const goals = await CardsDB.getGoalSubcategoryIdsForUser(user.id);

    let goalCategoryIds: number[];
    let favoriteSubcategoryIds: Set<number>;

    const categoryFilterArg = ctx.args.slice(1).join(' ').trim();
    if (categoryFilterArg) {
      // Focus mode: draw only within this category; no favorites needed, but still prioritized if present.
      const outcome = await resolveCategoryByIdOrName(categoryFilterArg);
      if (!outcome.ok) {
        await reply(ctx, outcome.message ?? `Uso: \`${GirarAutoCommand.info.usage}\``);
        return;
      }
      const category = outcome.value as { id: number; isHidden: boolean };
      if (category.isHidden) {
        await reply(ctx, 'Essa categoria não está disponível para girar no momento.');
        return;
      }
      goalCategoryIds = [category.id];
      favoriteSubcategoryIds = new Set(goals.filter(g => g.categoryId === category.id).map(g => g.subcategoryId));
    } else {
      if (goals.length === 0) {
        await reply(ctx, 'Você ainda não marcou nenhuma coleção como favorita. Use `/quero id ou nome` ou marque pelo site (`/cols`) antes de usar `/girarauto`. ⭐');
        return;
      }

      const categories = await CardsDB.getCategories();
      const categoriesById = new Map(categories.map(c => [c.id, c]));
      goalCategoryIds = [...new Set(goals.map(g => g.categoryId))].filter(id => !categoriesById.get(id)?.isHidden);
      if (goalCategoryIds.length === 0) {
        await reply(ctx, 'Suas coleções favoritas estão em categorias indisponíveis no momento. Marque outras com `/quero` antes de usar `/girarauto`. ⭐');
        return;
      }
      favoriteSubcategoryIds = new Set(goals.map(g => g.subcategoryId));
    }

    const categoryOrder = Array.from({ length: drawCount }, (_, i) => goalCategoryIds[i % goalCategoryIds.length]!);

    const claimed = await claimGirar(authorId, chatId, { workflowID: ctx.workflowIDToBeAssigned, kind: 'batch' });
    if (!claimed) {
      await reply(ctx, 'Você já está girando. Aguarde a mensagem com o resultado. 🎰');
      return;
    }

    try {
      const { draws, countsByCard } = await GachaLogic.runBulkDraws(user.id, categoryOrder, user.luckModifier, favoriteSubcategoryIds);
      const summary = await buildBulkDrawSummary(draws, { splitFavorites: true });

      if (draws.length === 0) {
        await reply(ctx, summary.header);
        return;
      }

      const runId = ctx.workflowIDToBeAssigned;
      await cacheBulkDrawSummary(runId, summary);

      const firstPage = renderBulkDrawSummaryPage(summary, 0);
      const navRow = pageNavRow('girarauto', runId, 0, firstPage.hasNext, firstPage.totalPages);
      await reply(ctx, {
        content: firstPage.content,
        photoUrl: firstPage.photoUrl,
        buttonRows: navRow.length ? [navRow] : undefined,
      });

      await emitCardsNew(user.id, authorId, ctx.message.author.name, ctx.message.platform, countsByCard);
    } finally {
      await releaseGirar(authorId, chatId);
    }
  }

  @Page({ name: 'girarauto', restricted: true })
  static async girarautoPage(runId: string, page: number) {
    const summary = await loadBulkDrawSummary(runId);
    if (!summary) return null;
    return renderBulkDrawSummaryPage(summary, page);
  }
}
