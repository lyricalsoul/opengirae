import { Command, Page, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply, toPageButton, pageNavRow } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { buildFilterArg, filterAdviceText, filterButtonsRow } from '@girae/common/utilities/pageFilters'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { FILTERS, loadSubcategoryCollection } from '../../services/cards/subcategoryCollection'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { attemptSubcategoryCompletionReward } from '../../services/cards/collectionCompletion'

const PAGE_SIZE = 20

async function renderPage(rawArg: string, page: number, viewerTelegramId: string, platform: 'telegram' | 'discord') {
  const loaded = await loadSubcategoryCollection(rawArg, viewerTelegramId, platform, page, PAGE_SIZE)
  if (!loaded) return null
  const { subcategory, category, rows: pageRows, totalCards, userOwnedCards, pct, filteredTotal, active, rest } = loaded

  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE))

  const rows = pageRows.length > 0
    ? pageRows.map(c => {
      // a card the user currently has in an active /leilao still counts as owned (stats-wise)
      // even though its stock is temporarily out of userCards - see CardsDB.getSubcategoryStats/
      // getCardsInSubcategoryForUserFiltered. Count the auctioned unit back in and mark it with
      // EMOJI.inAuction in the trailing slot instead of falling back to the "not owned"
      // categoryEmoji, which would otherwise read as "you don't have this".
      const totalCount = c.ownedCount + (c.inAuction ? 1 : 0)
      const badge = cativeiroEmoji(totalCount)
      const auctionMark = c.inAuction ? ` ${EMOJI.inAuction}` : ''
      const trailing = totalCount > 0 ? `\`${totalCount}x\`${auctionMark}` : c.categoryEmoji
      return `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** ${badge}${trailing}`
    }).join('\n')
    : '_Nenhum card para mostrar._'
  const advice = filterAdviceText(FILTERS, active, filteredTotal, 'cards')
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''

  const content = `${category?.emoji ?? EMOJI.subcategory} \`${subcategory.id}\`. **${escapeMarkdown(subcategory.name)}**
${EMOJI.dice} **${totalCards}** cards no total, \`${userOwnedCards}\` na sua coleção.
${EMOJI.progress} Coleção ${pct}% completa
${advice}
${rows}

${pageInfo}${EMOJI.browse} Para ver um desses cards, use \`/card id\`.`

  return {
    content,
    photoUrl: subcategory.imageUrl ?? undefined,
    hasNext: page < totalPages - 1,
    totalPages,
    extraRows: [filterButtonsRow(FILTERS, active, rest)],
  }
}

export default class CollectionCommand extends Command {
  static override info = {
    name: 'clc',
    description: 'Mostra uma subcategoria e seus cards',
    usage: '/clc <nome ou ID da subcategoria>',
    aliases: ['sub', 'colec', 'collec', 'col'],
  }

  @CommandArgument([{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY, description: 'ID ou nome da subcategoria' }])
  static override async execute(ctx: IncomingCommand, args: { subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const arg = buildFilterArg([], String(args.subcategory.id))
    const page = await renderPage(arg, 0, ctx.message.author.id, ctx.message.platform as 'telegram' | 'discord')
    if (!page) return

    const navRow = pageNavRow('clc', arg, 0, page.hasNext, page.totalPages)
    await reply(ctx, {
      content: page.content,
      photoUrl: page.photoUrl,
      buttonRows: [
        ...page.extraRows.map(row => row.map(b => toPageButton('clc', b))),
        ...(navRow.length ? [navRow] : []),
      ],
    })

    // backfill for a subcategory completed before this feature shipped - idempotent, safe on every view.
    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (viewer) {
      await attemptSubcategoryCompletionReward(viewer.id, args.subcategory.id, ctx.message.author.id, ctx.message.author.name, ctx.message.platform as 'telegram' | 'discord')
    }
  }

  @Page({ name: 'clc', restricted: true })
  static async clcPage(arg: string, page: number, authorId: string, platform: 'telegram' | 'discord') {
    return renderPage(arg, page, authorId, platform)
  }
}
