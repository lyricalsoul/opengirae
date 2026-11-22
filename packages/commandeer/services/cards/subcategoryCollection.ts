import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { parseFilterArg, type FilterDef } from '@girae/common/utilities/pageFilters'

export type CardRow = Awaited<ReturnType<typeof CardsDB.getCardsInSubcategoryForUserFiltered>>[number]

export const FILTERS: FilterDef<CardRow>[] = [
  { id: '1', emoji: '☀', description: 'que você possui', match: c => c.ownedCount > 0 },
  { id: '2', emoji: '🌙', description: 'que você não possui', match: c => c.ownedCount === 0 },
  { id: '3', emoji: '🥉', description: 'com raridade comum', match: c => c.rarityName === 'Comum' },
  { id: '4', emoji: '🥈', description: 'com raridade rara', match: c => c.rarityName === 'Raro' },
  { id: '5', emoji: '🥇', description: 'com raridade lendária', match: c => c.rarityName === 'Lendário' },
  { id: '6', emoji: '🔁', description: 'repetidas', match: c => c.ownedCount > 1 },
]

const RARITY_NAME_BY_FILTER_ID: Record<string, string> = { '3': 'Comum', '4': 'Raro', '5': 'Lendário' }

export async function loadSubcategoryCollection(rawArg: string, viewerTelegramId: string, platform: 'telegram' | 'discord', page: number, pageSize: number) {
  const { active, rest } = parseFilterArg(rawArg)
  const subcategoryId = parseInt(rest, 10)

  const subcategory = await CardsDB.getSubcategory(subcategoryId)
  if (!subcategory) return null

  const [category, viewer] = await Promise.all([
    CardsDB.getCategory(subcategory.categoryId),
    UsersDB.getUserByPlatformAccount(platform, viewerTelegramId),
  ])
  if (!viewer) return { subcategory, category, rows: [] as CardRow[], totalCards: 0, userOwnedCards: 0, pct: 0, filteredTotal: 0, active, rest }

  const ownedActive = active.includes('1')
  const missingActive = active.includes('2')
  const rarityFilterIds = ['3', '4', '5'].filter(id => active.includes(id))
  const duplicatesOnly = active.includes('6')
  // a card you don't own can't be a duplicate - same contradiction shape as owned+missing together
  const impossible = (ownedActive && missingActive) || rarityFilterIds.length > 1 || (duplicatesOnly && missingActive)

  const ownedFilter = ownedActive ? 'owned' as const : missingActive ? 'missing' as const : undefined
  const rarityName = rarityFilterIds[0] ? RARITY_NAME_BY_FILTER_ID[rarityFilterIds[0]] : undefined

  const [stats, rows] = await Promise.all([
    CardsDB.getSubcategoryStats(subcategoryId, viewer.id, { ownedFilter, rarityName, duplicatesOnly }),
    impossible ? Promise.resolve([]) : CardsDB.getCardsInSubcategoryForUserFiltered(subcategoryId, viewer.id, { ownedFilter, rarityName, duplicatesOnly, limit: pageSize, offset: page * pageSize }),
  ])

  return {
    subcategory, category, rows,
    totalCards: stats.total,
    userOwnedCards: stats.owned,
    pct: stats.total > 0 ? Math.round((stats.owned / stats.total) * 100) : 0,
    filteredTotal: impossible ? 0 : stats.filteredTotal,
    active, rest,
  }
}
