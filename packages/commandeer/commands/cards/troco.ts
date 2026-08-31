import { Command, Page, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply, pageNavRow, toPageButton } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import { resolveCardByIdOrName } from '../../services/commandArguments'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { applyFilters, filterAdviceText, filterButtonsRow, parseFilterArg, buildFilterArg, type FilterDef } from '@girae/common/utilities/pageFilters'
import { generateWishlistImage } from '@girae/common/ditto'

const MAX_CARDS = 50
const PAGE_SIZE = 10

type TradableCardRow = Awaited<ReturnType<typeof CardsDB.getUserTradableCards>>[number]

const FILTERS: FilterDef<TradableCardRow>[] = [
  { id: '1', emoji: '🥉', description: 'com raridade comum', match: c => c.rarityName === 'Comum' },
  { id: '2', emoji: '🥈', description: 'com raridade rara', match: c => c.rarityName === 'Raro' },
  { id: '3', emoji: '🥇', description: 'com raridade lendária', match: c => c.rarityName === 'Lendário' },
]

const CATEGORY_BUTTONS_PER_ROW = 6

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}

// rest is "<userId>" or "<userId>:<categoryId>".
function parseRest(rest: string): { userIdPart: string; selectedCategoryId?: number } {
  const sep = rest.indexOf(':')
  if (sep === -1) return { userIdPart: rest }
  const categoryIdPart = rest.slice(sep + 1)
  return { userIdPart: rest.slice(0, sep), selectedCategoryId: categoryIdPart ? parseInt(categoryIdPart, 10) : undefined }
}

export async function renderPage(rawArg: string, page: number) {
  const { active, rest } = parseFilterArg(rawArg)
  const { userIdPart, selectedCategoryId } = parseRest(rest)
  const target = await UsersDB.getUserById(parseInt(userIdPart, 10))
  if (!target) return null

  const allCards = await CardsDB.getUserTradableCards(target.id)
  const rarityFiltered = applyFilters(allCards, FILTERS, active)
  const filtered = selectedCategoryId === undefined
    ? rarityFiltered
    : rarityFiltered.filter(c => c.categoryId === selectedCategoryId)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const rows = slice.length > 0
    ? slice.map(c => {
      const badge = cativeiroEmoji(c.ownedCount)
      return `${c.categoryEmoji ?? EMOJI.subcategory} ${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** \`${c.ownedCount}x\` ${badge} — _${escapeMarkdown(c.subcategoryName ?? '?')}_`
    }).join('\n')
    : '_Nenhum card encontrado._'
  const rarityAdvice = filterAdviceText(FILTERS, active, filtered.length, 'cards')
  const selectedCategory = selectedCategoryId === undefined ? undefined : allCards.find(c => c.categoryId === selectedCategoryId)
  const categoryAdvice = selectedCategory
    ? `🔎 Mostrando apenas cards de **${escapeMarkdown(selectedCategory.categoryName ?? '?')}** (\`${filtered.length}\` resultados)\n`
    : ''
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''

  const content = `🔄 \`${target.id}\`. Lista de trocáveis de **${escapeMarkdown(target.displayName)}**
${EMOJI.dice} \`${allCards.length}\` card${allCards.length === 1 ? '' : 's'} na lista.
${rarityAdvice}${categoryAdvice}
${rows}

${pageInfo}${EMOJI.browse} Para adicionar ou remover, use \`/troco\` ou \`/naotroco\`.`

  const dittoCards = slice
    .filter(c => c.imageUrl)
    .slice(0, 10)
    .map(c => ({ id: c.id, name: c.name, imageUrl: c.imageUrl! }))
  const image = dittoCards.length > 0 ? await generateWishlistImage(dittoCards) : null

  // one button per category with a tradable card; click narrows, click ✅ again clears.
  const categoriesPresent = [...new Map(
    allCards.filter((c): c is typeof c & { categoryId: number } => c.categoryId !== null)
      .map(c => [c.categoryId, { id: c.categoryId, emoji: c.categoryEmoji ?? EMOJI.subcategory }]),
  ).values()].sort((a, b) => a.id - b.id)

  const categoryButtonRows = chunk(categoriesPresent, CATEGORY_BUTTONS_PER_ROW).map(row => row.map(cat => ({
    text: selectedCategoryId === cat.id ? '✅' : cat.emoji,
    arg: buildFilterArg(active, selectedCategoryId === cat.id ? userIdPart : `${userIdPart}:${cat.id}`),
    page: 0,
  })))

  return {
    content,
    photoUrl: image?.url,
    hasNext: page < totalPages - 1,
    totalPages,
    extraRows: [filterButtonsRow(FILTERS, active, rest), ...categoryButtonRows],
  }
}

async function replyTradableList(ctx: IncomingCommand, viewer: { id: number }) {
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

  const navRow = pageNavRow('troco', arg, 0, page.hasNext, page.totalPages)
  await reply(ctx, {
    content: page.content,
    photoUrl: page.photoUrl,
    buttonRows: [
      ...page.extraRows.map(row => row.map(b => toPageButton('troco', b))),
      ...(navRow.length ? [navRow] : []),
    ],
  })
}

export default class TrocoCommand extends Command {
  static override info = {
    name: 'troco',
    description: 'Marca cartas como trocáveis, ou lista suas cartas trocáveis se usado sem argumentos',
    usage: '/troco [id ou nome do card] [id2 id3 ...]',
  }

  @CommandArgument([{ name: 'cardsRaw', type: CommandArgumentType.STRING, nullable: true, description: 'ID(s) ou nome do card' }])
  static override async execute(ctx: IncomingCommand, args: { cardsRaw?: string }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    if (!args.cardsRaw) {
      await replyTradableList(ctx, user)
      return
    }

    const tokens = args.cardsRaw.split(/\s+/).filter(Boolean)

    if (tokens.length === 1 || !tokens.every(t => /^\d+$/.test(t))) {
      const outcome = await resolveCardByIdOrName(args.cardsRaw)
      if (!outcome.ok) {
        await reply(ctx, outcome.message ?? `Uso: \`${this.info.usage}\``)
        return
      }
      const card = outcome.value as { id: number; name: string }
      if (!(await CardsDB.hasUserCard(user.id, card.id))) {
        await reply(ctx, '😂 Troca o que? Você não tem esse card.')
        return
      }
      await CardsDB.setCardTradable(user.id, card.id, true)
      await reply(ctx, `🔄 **${escapeMarkdown(card.name)}** agora está marcado como trocável.`)
      return
    }

    if (tokens.length > MAX_CARDS) {
      await reply(ctx, `Você só pode marcar até ${MAX_CARDS} cards de uma vez.`)
      return
    }

    const uniqueIds = [...new Set(tokens.map(t => parseInt(t, 10)))]
    const owned = await CardsDB.getOwnedCardQuantities(user.id, uniqueIds)
    const ownedIds = new Set(owned.map(o => o.cardId))

    const validIds = uniqueIds.filter(id => ownedIds.has(id))
    const skippedIds = uniqueIds.filter(id => !ownedIds.has(id))

    if (validIds.length === 0) {
      await reply(ctx, '😂 Troca o que? Você não tem nenhum desses cards.')
      return
    }

    const cards = await CardsDB.getCardsByIds(validIds)
    const cardsById = new Map(cards.map(c => [c.id, c]))
    for (const id of validIds) await CardsDB.setCardTradable(user.id, id, true)

    const list = validIds.map(id => {
      const c = cardsById.get(id)
      return c ? `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**` : `\`${id}\``
    }).join('\n')
    const skippedNote = skippedIds.length > 0 ? `\n\n⚠️ Ignorados (você não tem): ${skippedIds.map(id => `\`${id}\``).join(', ')}` : ''

    await reply(ctx, `🔄 **Marcados como trocáveis:**\n${list}${skippedNote}`)
  }

  @Page({ name: 'troco' })
  static async trocoListPage(arg: string, page: number, authorId: string, platform: 'telegram' | 'discord') {
    const { rest } = parseFilterArg(arg)
    const target = await UsersDB.getUserById(parseInt(rest, 10))
    if (!target) return null

    const viewer = await UsersDB.getUserByPlatformAccount(platform, authorId)
    if (!viewer) return null
    if (!UsersDB.isViewable(viewer.id, target)) return null

    return renderPage(arg, page)
  }
}
