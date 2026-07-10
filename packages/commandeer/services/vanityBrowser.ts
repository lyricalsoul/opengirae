import { VanitiesDB } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import { EMOJI } from '../constants'
import { applyFilters, filterAdviceText, filterButtonsRow, parseFilterArg, type FilterDef } from '@girae/common/utilities/pageFilters'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const PAGE_SIZE = 20

export const TYPE_LABEL = { background: 'papel de parede', sticker: 'sticker' } as const
export type VanityType = keyof typeof TYPE_LABEL

type StoreItemRow = Awaited<ReturnType<typeof VanitiesDB.listStoreItemsByType>>[number]

function filtersFor(ownedIds: Set<number>): FilterDef<StoreItemRow>[] {
  return [
    { id: '1', emoji: '✅', description: 'que você possui', match: i => ownedIds.has(i.id) },
    { id: '2', emoji: '🆕', description: 'que você não possui', match: i => !ownedIds.has(i.id) },
  ]
}

export async function renderVanityBrowsePage(rawArg: string, page: number, viewerTelegramId: string) {
  const { active, rest } = parseFilterArg(rawArg)
  const type = rest as VanityType

  const [items, user] = await Promise.all([
    VanitiesDB.listStoreItemsByType(type),
    UsersDB.getUserByTelegramId(viewerTelegramId),
  ])
  const ownedIds = new Set(user ? await VanitiesDB.getBoughtItemIds(user.id) : [])
  const filters = filtersFor(ownedIds)

  const filtered = applyFilters(items, filters, active)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const rows = slice.length > 0
    ? slice.map(i => `${ownedIds.has(i.id) ? '✅' : '💸'} \`${i.id}\`. **${escapeMarkdown(i.title)}** — ${i.price} moedas`).join('\n')
    : '_Nenhum item para mostrar._'
  const advice = filterAdviceText(filters, active, filtered.length, `${TYPE_LABEL[type]}s`)
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''
  const viewCommand = type === 'background' ? 'bg' : 'sticker'

  const content = `🛍 Loja de ${TYPE_LABEL[type]}s
${EMOJI.dice} \`${items.length}\` itens no total.
${advice}
${rows}

${pageInfo}${EMOJI.browse} Para ver um desses itens, use \`/${viewCommand} id\`.`

  return {
    content,
    hasNext: page < totalPages - 1,
    extraRows: [filterButtonsRow(filters, active, type)],
  }
}
