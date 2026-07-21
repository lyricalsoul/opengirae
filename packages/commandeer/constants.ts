export const EMOJI = {
  category: '📁',
  subcategory: '📂',
  tag: '🔖',
  owner: '👾',
  quickView: '🧁',
  ownersCount: '👨‍👨‍👧‍👧',
  circulation: '📦',
  search: '🔍',
  dice: '🎲',
  page: '📃',
  browse: '👀',
  progress: '📊',
  goal: '⭐',
}

const CATIVEIRO_TIERS: Array<[min: number, emoji: string]> = [
  [1000, '🏆'],
  [500, '👑'],
  [250, '🪅'],
  [100, '❤️‍🔥'],
  [70, '💘'],
  [50, '💖'],
  [30, '🌟'],
  [15, '💫'],
  [5, '✨'],
]

export function cativeiroEmoji(count: number): string {
  for (const [min, emoji] of CATIVEIRO_TIERS) {
    if (count >= min) return emoji
  }
  return ''
}
