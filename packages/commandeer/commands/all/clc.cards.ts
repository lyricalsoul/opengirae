import { Command, Page, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply, toPageButton, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { applyFilters, buildFilterArg, filterAdviceText, filterButtonsRow, parseFilterArg, type FilterDef } from '@girae/common/utilities/pageFilters'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const PAGE_SIZE = 20

type CardRow = Awaited<ReturnType<typeof CardsDB.getCardsInSubcategoryForUser>>[number]

const FILTERS: FilterDef<CardRow>[] = [
  { id: '1', emoji: '☀', description: 'que você possui', match: c => c.ownedCount > 0 },
  { id: '2', emoji: '🌙', description: 'que você não possui', match: c => c.ownedCount === 0 },
  { id: '3', emoji: '🥉', description: 'com raridade comum', match: c => c.rarityName === 'Comum' },
  { id: '4', emoji: '🥈', description: 'com raridade rara', match: c => c.rarityName === 'Raro' },
  { id: '5', emoji: '🥇', description: 'com raridade lendária', match: c => c.rarityName === 'Lendário' },
]

async function renderPage(rawArg: string, page: number, viewerTelegramId: string) {
  const { active, rest } = parseFilterArg(rawArg)
  const subcategoryId = parseInt(rest, 10)

  const subcategory = await CardsDB.getSubcategory(subcategoryId)
  if (!subcategory) return null

  const [category, viewer] = await Promise.all([
    CardsDB.getCategory(subcategory.categoryId),
    UsersDB.getUserByTelegramId(viewerTelegramId),
  ])
  const allCards = viewer ? await CardsDB.getCardsInSubcategoryForUser(subcategoryId, viewer.id) : []
  const userOwnedCards = allCards.filter(c => c.ownedCount > 0).length

  const cards = applyFilters(allCards, FILTERS, active)
  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE))
  const slice = cards.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const rows = slice.length > 0
    ? slice.map(c => {
      const badge = cativeiroEmoji(c.ownedCount)
      const trailing = c.ownedCount > 0 ? `\`${c.ownedCount}x\`` : c.categoryEmoji
      return `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** ${badge}${trailing}`
    }).join('\n')
    : '_Nenhum card para mostrar._'
  const advice = filterAdviceText(FILTERS, active, cards.length, 'cards')
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''

  const content = `${category?.emoji ?? EMOJI.subcategory} \`${subcategory.id}\`. **${escapeMarkdown(subcategory.name)}**
${EMOJI.dice} \`${allCards.length}\` cards no total, \`${userOwnedCards}\` na sua coleção.
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

  @CommandArgument([{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY }])
  static override async execute(ctx: IncomingCommand, args: { subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const arg = buildFilterArg([], String(args.subcategory.id))
    const page = await renderPage(arg, 0, ctx.message.author.id)
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
  }

  @Page({ name: 'clc', restricted: true })
  static async clcPage(arg: string, page: number, authorId: string) {
    return renderPage(arg, page, authorId)
  }
}
