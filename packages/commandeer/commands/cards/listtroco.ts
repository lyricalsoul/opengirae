import { Command, Page } from '@girae/common/commands'
import { reply, pageNavRow, toPageButton } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { applyFilters, filterAdviceText, filterButtonsRow, parseFilterArg, buildFilterArg, type FilterDef } from '@girae/common/utilities/pageFilters'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { generateWishlistImage } from '@girae/common/ditto'

const PAGE_SIZE = 10

type TradableCardRow = Awaited<ReturnType<typeof CardsDB.getUserTradableCards>>[number]

const FILTERS: FilterDef<TradableCardRow>[] = [
  { id: '1', emoji: '🥉', description: 'com raridade comum', match: c => c.rarityName === 'Comum' },
  { id: '2', emoji: '🥈', description: 'com raridade rara', match: c => c.rarityName === 'Raro' },
  { id: '3', emoji: '🥇', description: 'com raridade lendária', match: c => c.rarityName === 'Lendário' },
]

export async function renderPage(rawArg: string, page: number) {
  const { active, rest } = parseFilterArg(rawArg)
  const target = await UsersDB.getUserById(parseInt(rest, 10))
  if (!target) return null

  const allCards = await CardsDB.getUserTradableCards(target.id)
  const filtered = applyFilters(allCards, FILTERS, active)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const rows = slice.length > 0
    ? slice.map(c => {
      const badge = cativeiroEmoji(c.ownedCount)
      return `${c.categoryEmoji ?? EMOJI.subcategory} ${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** \`${c.ownedCount}x\` ${badge} — _${escapeMarkdown(c.subcategoryName ?? '?')}_`
    }).join('\n')
    : '_Nenhum card encontrado._'
  const advice = filterAdviceText(FILTERS, active, filtered.length, 'cards')
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''

  const content = `🔄 \`${target.id}\`. Lista de trocáveis de **${escapeMarkdown(target.displayName)}**
${EMOJI.dice} \`${allCards.length}\` card${allCards.length === 1 ? '' : 's'} na lista.
${advice}
${rows}

${pageInfo}${EMOJI.browse} Para adicionar ou remover, use \`/troco\` ou \`/naotroco\`.`

  const dittoCards = slice
    .filter(c => c.imageUrl)
    .slice(0, 10)
    .map(c => ({ id: c.id, name: c.name, imageUrl: c.imageUrl! }))
  const image = dittoCards.length > 0 ? await generateWishlistImage(dittoCards) : null

  return {
    content,
    photoUrl: image?.url,
    hasNext: page < totalPages - 1,
    totalPages,
    extraRows: [filterButtonsRow(FILTERS, active, rest)],
  }
}

export default class ListTrocoCommand extends Command {
  static override info = {
    name: 'listtroco',
    description: 'Lista as cartas trocáveis de um usuário',
    usage: '/listtroco',
  }

  static override async execute(ctx: IncomingCommand) {
    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!viewer) return

    let target = viewer
    const replyToId = ctx.message.replyTo?.author.id
    if (replyToId) {
      const replyTarget = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', replyToId)
      if (!replyTarget) {
        await reply(ctx, 'Esse usuário nunca usou a bot!')
        return
      }
      if (!UsersDB.isViewable(viewer.id, replyTarget)) {
        await reply(ctx, 'Esse usuário ativou o modo privado e não é possível ver a lista de trocáveis dele. 🔒')
        return
      }
      target = replyTarget
    }

    const arg = buildFilterArg([], String(target.id))
    const page = await renderPage(arg, 0)
    if (!page) return

    const navRow = pageNavRow('listtroco', arg, 0, page.hasNext, page.totalPages)
    await reply(ctx, {
      content: page.content,
      photoUrl: page.photoUrl,
      buttonRows: [
        ...page.extraRows.map(row => row.map(b => toPageButton('listtroco', b))),
        ...(navRow.length ? [navRow] : []),
      ],
    })
  }

  @Page({ name: 'listtroco' })
  static async listTrocoPage(arg: string, page: number, authorId: string, platform: 'telegram' | 'discord') {
    const { rest } = parseFilterArg(arg)
    const target = await UsersDB.getUserById(parseInt(rest, 10))
    if (!target) return null

    const viewer = await UsersDB.getUserByPlatformAccount(platform, authorId)
    if (!viewer) return null
    if (!UsersDB.isViewable(viewer.id, target)) return null

    return renderPage(arg, page)
  }
}
