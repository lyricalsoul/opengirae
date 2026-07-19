import { Command, Page } from '@girae/common/commands'
import { reply, toPageButton, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { applyFilters, filterAdviceText, filterButtonsRow, parseFilterArg, type FilterDef } from '@girae/common/utilities/pageFilters'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const PAGE_SIZE = 20

type OwnedCardRow = Awaited<ReturnType<typeof CardsDB.getUserOwnedCards>>[number]

const FILTERS: FilterDef<OwnedCardRow>[] = [
  { id: '1', emoji: '🥉', description: 'com raridade comum', match: c => c.rarityName === 'Comum' },
  { id: '2', emoji: '🥈', description: 'com raridade rara', match: c => c.rarityName === 'Raro' },
  { id: '3', emoji: '🥇', description: 'com raridade lendária', match: c => c.rarityName === 'Lendário' },
]

async function renderPage(rawArg: string, page: number, viewerTelegramId: string, platform: 'telegram' | 'discord') {
  const { active } = parseFilterArg(rawArg)

  const viewer = await UsersDB.getUserByPlatformAccount(platform, viewerTelegramId)
  if (!viewer) return null

  const allCards = await CardsDB.getUserOwnedCards(viewer.id)
  const cards = applyFilters(allCards, FILTERS, active)
  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE))
  const slice = cards.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const rows = slice.length > 0
    ? slice.map(c => {
      const badge = cativeiroEmoji(c.ownedCount)
      return `${c.categoryEmoji ?? EMOJI.subcategory} ${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** \`${c.ownedCount}x\` ${badge} — _${escapeMarkdown(c.subcategoryName ?? '?')}_`
    }).join('\n')
    : '_Nenhum card para mostrar._'
  const advice = filterAdviceText(FILTERS, active, cards.length, 'cards')
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''
  const totalCopies = allCards.reduce((sum, c) => sum + c.ownedCount, 0)

  const content = `👤 \`${viewer.id}\`. Cards de **${escapeMarkdown(viewer.displayName)}**
${EMOJI.dice} \`${totalCopies}\` cards no total.
${advice}
${rows}

${pageInfo}${EMOJI.browse} Para ver um desses cards, use \`/card id\`.`

  return {
    content,
    hasNext: page < totalPages - 1,
    totalPages,
    extraRows: [filterButtonsRow(FILTERS, active, '')],
  }
}

export default class CardsListCommand extends Command {
  static override info = {
    name: 'cts',
    description: 'Mostra suas cartas em formato de lista',
    usage: '/cts',
  }

  static override async execute(ctx: IncomingCommand) {
    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!viewer) return

    const cardCount = await CardsDB.getUserCardsCount(viewer.id)
    if (cardCount === 0) {
      await reply(ctx, 'Você ainda não tem nenhum card. 😔')
      return
    }

    const page = await renderPage('', 0, ctx.message.author.id, ctx.message.platform as 'telegram' | 'discord')
    if (!page) return

    const navRow = pageNavRow('cts', '', 0, page.hasNext, page.totalPages)
    await reply(ctx, {
      content: page.content,
      buttonRows: [
        ...page.extraRows.map(row => row.map(b => toPageButton('cts', b))),
        ...(navRow.length ? [navRow] : []),
      ],
    })
  }

  @Page({ name: 'cts', restricted: true })
  static async ctsPage(arg: string, page: number, authorId: string, platform: 'telegram' | 'discord') {
    return renderPage(arg, page, authorId, platform)
  }
}
