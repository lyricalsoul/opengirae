import { Command, Page } from '@girae/common/commands'
import { reply, toPageButton, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { applyFilters, filterAdviceText, filterButtonsRow, parseFilterArg, buildFilterArg, type FilterDef } from '@girae/common/utilities/pageFilters'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const PAGE_SIZE = 10

// telegram caption cap is 1024 chars (vs 4096 for plain text) - names are unbounded, so this stays as a fallback even with the smaller page size
const MAX_CONTENT_LENGTH_FOR_PHOTO = 950

type OwnedCardRow = Awaited<ReturnType<typeof CardsDB.getUserOwnedCards>>[number]

const FILTERS: FilterDef<OwnedCardRow>[] = [
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

async function resolveFavoriteCardMedia(userId: number, favoriteCardId: number | null): Promise<{ photoUrl?: string; isVideo?: boolean }> {
  if (!favoriteCardId) return {}
  const [card, owned] = await Promise.all([
    CardsDB.getCardWithDetails(favoriteCardId),
    CardsDB.getUserCard(userId, favoriteCardId),
  ])
  const photoUrl = owned?.customMediaUrl ?? card?.imageUrl ?? undefined
  return { photoUrl, isVideo: owned?.customMediaType === 'video' }
}

export async function renderPage(rawArg: string, page: number, viewerTelegramId: string, platform: 'telegram' | 'discord') {
  const { active, rest } = parseFilterArg(rawArg)
  const selectedCategoryId = rest ? parseInt(rest, 10) : undefined

  const viewer = await UsersDB.getUserByPlatformAccount(platform, viewerTelegramId)
  if (!viewer) return null

  const allCards = await CardsDB.getUserOwnedCards(viewer.id)
  const rarityFiltered = applyFilters(allCards, FILTERS, active)
  const cards = selectedCategoryId === undefined
    ? rarityFiltered
    : rarityFiltered.filter(c => c.categoryId === selectedCategoryId)
  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE))
  const slice = cards.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const rows = slice.length > 0
    ? slice.map(c => {
      // see CardsDB.getUserOwnedCards's note - a card in an active /leilao still shows up here.
      const totalCount = c.ownedCount + (c.inAuction ? 1 : 0)
      const badge = cativeiroEmoji(totalCount)
      const auctionMark = c.inAuction ? ` ${EMOJI.inAuction}` : ''
      return `${c.categoryEmoji ?? EMOJI.subcategory} ${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** \`${totalCount}x\`${auctionMark} ${badge} — _${escapeMarkdown(c.subcategoryName ?? '?')}_`
    }).join('\n')
    : '_Nenhum card para mostrar._'
  const advice = filterAdviceText(FILTERS, active, cards.length, 'cards')
  const selectedCategory = selectedCategoryId === undefined ? undefined : allCards.find(c => c.categoryId === selectedCategoryId)
  const categoryAdvice = selectedCategory
    ? `🔎 Mostrando apenas cards de **${escapeMarkdown(selectedCategory.categoryName ?? '?')}** (\`${cards.length}\` resultados)\n`
    : ''
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''
  const totalCopies = allCards.reduce((sum, c) => sum + c.ownedCount + (c.inAuction ? 1 : 0), 0)

  const content = `👤 \`${viewer.id}\`. Cards de **${escapeMarkdown(viewer.displayName)}**
${EMOJI.dice} \`${totalCopies}\` cards no total.
${advice}${categoryAdvice}
${rows}

${pageInfo}${EMOJI.browse} Para ver um desses cards, use \`/card id\`.`

  const media = content.length <= MAX_CONTENT_LENGTH_FOR_PHOTO
    ? await resolveFavoriteCardMedia(viewer.id, viewer.favoriteCardId)
    : {}

  // one button per owned category; same click-to-narrow/click-✅-to-clear shape as /troco.
  const categoriesPresent = [...new Map(
    allCards.filter((c): c is typeof c & { categoryId: number } => c.categoryId !== null)
      .map(c => [c.categoryId, { id: c.categoryId, emoji: c.categoryEmoji ?? EMOJI.subcategory }]),
  ).values()].sort((a, b) => a.id - b.id)

  const categoryButtonRows = chunk(categoriesPresent, CATEGORY_BUTTONS_PER_ROW).map(row => row.map(cat => ({
    text: selectedCategoryId === cat.id ? '✅' : cat.emoji,
    arg: buildFilterArg(active, selectedCategoryId === cat.id ? '' : String(cat.id)),
    page: 0,
  })))

  return {
    content,
    photoUrl: media.photoUrl,
    isVideo: media.isVideo,
    hasNext: page < totalPages - 1,
    totalPages,
    extraRows: [filterButtonsRow(FILTERS, active, rest), ...categoryButtonRows],
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
      photoUrl: page.photoUrl,
      isVideo: page.isVideo,
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
