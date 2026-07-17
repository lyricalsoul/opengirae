import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { applyFilters, parseFilterArg, type FilterDef } from '@girae/common/utilities/pageFilters'

export type CardRow = Awaited<ReturnType<typeof CardsDB.getCardsInSubcategoryForUser>>[number]

export const FILTERS: FilterDef<CardRow>[] = [
  { id: '1', emoji: '☀', description: 'que você possui', match: c => c.ownedCount > 0 },
  { id: '2', emoji: '🌙', description: 'que você não possui', match: c => c.ownedCount === 0 },
  { id: '3', emoji: '🥉', description: 'com raridade comum', match: c => c.rarityName === 'Comum' },
  { id: '4', emoji: '🥈', description: 'com raridade rara', match: c => c.rarityName === 'Raro' },
  { id: '5', emoji: '🥇', description: 'com raridade lendária', match: c => c.rarityName === 'Lendário' },
]

export async function loadSubcategoryCollection(rawArg: string, viewerTelegramId: string) {
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
  const pct = allCards.length > 0 ? Math.round((userOwnedCards / allCards.length) * 100) : 0

  const cards = applyFilters(allCards, FILTERS, active)

  return { subcategory, category, allCards, cards, userOwnedCards, pct, active, rest }
}
