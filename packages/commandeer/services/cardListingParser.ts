const RARITY_EMOJI: Record<string, string> = { '🥇': 'Lendário', '🥈': 'Raro', '🥉': 'Comum' }
const CATEGORY_EMOJI_ID: Record<string, number> = {
  '📕': 3, '🍿': 4, '🪩': 1, '🎭': 6, '📚': 7, '🕹️': 5, '🎎': 4, '⭐️': 6, '💽': 6
}
export interface ParsedCardListing {
  name: string
  rarity: string
  subcategory: string
  categoryId: number
}

const LINE_RE = /^(\S+)\s+\d+\.\s*(.+)$/u

export function parseCardListing(text: string): ParsedCardListing | null {
  const lines = text.split('\n')
  const rarityMatch = lines[0]?.match(LINE_RE)
  const categoryMatch = lines[1]?.match(LINE_RE)
  if (!rarityMatch || !categoryMatch) return null

  const rarity = RARITY_EMOJI[rarityMatch[1]!]
  const categoryId = CATEGORY_EMOJI_ID[categoryMatch[1]!]
  if (!rarity || !categoryId) return null

  return { name: rarityMatch[2]!.trim(), rarity, subcategory: categoryMatch[2]!.trim(), categoryId }
}

export interface ParsedSubcategoryListing {
  subcategory: string
  categoryId: number
}

export function parseSubcategoryListing(text: string): ParsedSubcategoryListing | null {
  const match = text.split('\n')[0]?.match(LINE_RE)
  if (!match) return null
  const categoryId = CATEGORY_EMOJI_ID[match[1]!]
  if (!categoryId) return null
  return { subcategory: match[2]!.trim(), categoryId }
}
