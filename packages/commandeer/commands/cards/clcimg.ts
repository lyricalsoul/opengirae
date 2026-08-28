import { Command, Page, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply, toPageButton, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { buildFilterArg, filterAdviceText, filterButtonsRow } from '@girae/common/utilities/pageFilters'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { FILTERS, loadSubcategoryCollection } from '../../services/cards/subcategoryCollection'
import { FALLBACK_IMAGE } from './card'
import { UsersDB } from '@girae/database/users'
import { attemptSubcategoryCompletionReward } from '../../services/cards/collectionCompletion'

async function renderPage(rawArg: string, page: number, viewerTelegramId: string, platform: 'telegram' | 'discord') {
  const loaded = await loadSubcategoryCollection(rawArg, viewerTelegramId, platform, page, 1)
  if (!loaded) return null
  const { subcategory, category, rows, totalCards, userOwnedCards, pct, filteredTotal, active, rest } = loaded

  const totalPages = Math.max(1, filteredTotal)
  const card = rows[0]

  const advice = filterAdviceText(FILTERS, active, filteredTotal, 'cards')
  const cardLine = card
    ? (() => {
      // see clc.ts's note - a card in an active /leilao still counts as owned here.
      const totalCount = card.ownedCount + (card.inAuction ? 1 : 0)
      const badge = cativeiroEmoji(totalCount)
      const auctionMark = card.inAuction ? ` ${EMOJI.inAuction}` : ''
      const trailing = totalCount > 0 ? `\`${totalCount}x\`${auctionMark}` : card.categoryEmoji
      return `${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}** ${badge}${trailing}`
    })()
    : '_Nenhum card para mostrar._'
  const pageInfo = card ? `${EMOJI.page} Card \`${page + 1}\` de **${totalPages}**\n` : ''

  const content = `${category?.emoji ?? EMOJI.subcategory} \`${subcategory.id}\`. **${escapeMarkdown(subcategory.name)}**
${EMOJI.dice} **${totalCards}** cards no total, \`${userOwnedCards}\` na sua coleção.
${EMOJI.progress} Coleção ${pct}% completa
${advice}
${cardLine}

${pageInfo}${EMOJI.browse} Para ver mais detalhes desse card, use \`/card id\`.`

  return {
    content,
    photoUrl: card?.imageUrl ?? FALLBACK_IMAGE,
    hasNext: page < totalPages - 1,
    totalPages,
    extraRows: [filterButtonsRow(FILTERS, active, rest)],
  }
}

export default class CollectionImageCommand extends Command {
  static override info = {
    name: 'clcimg',
    description: 'Mostra os cards de uma subcategoria, um por um, com a imagem de cada card',
    usage: '/clcimg <nome ou ID da subcategoria>',
    aliases: ['subimg', 'colecimg'],
  }

  @CommandArgument([{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY, description: 'ID ou nome da subcategoria' }])
  static override async execute(ctx: IncomingCommand, args: { subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const arg = buildFilterArg([], String(args.subcategory.id))
    const page = await renderPage(arg, 0, ctx.message.author.id, ctx.message.platform as 'telegram' | 'discord')
    if (!page) return

    const navRow = pageNavRow('clcimg', arg, 0, page.hasNext, page.totalPages)
    await reply(ctx, {
      content: page.content,
      photoUrl: page.photoUrl,
      buttonRows: [
        ...page.extraRows.map(row => row.map(b => toPageButton('clcimg', b))),
        ...(navRow.length ? [navRow] : []),
      ],
    })

    // backfill for a subcategory completed before this feature shipped - idempotent, safe on every view.
    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (viewer) {
      await attemptSubcategoryCompletionReward(viewer.id, args.subcategory.id, ctx.message.author.id, ctx.message.author.name, ctx.message.platform as 'telegram' | 'discord')
    }
  }

  @Page({ name: 'clcimg', restricted: true })
  static async clcimgPage(arg: string, page: number, authorId: string, platform: 'telegram' | 'discord') {
    return renderPage(arg, page, authorId, platform)
  }
}
