import type { BulkDrawResult } from '@girae/database/gacha'
import { generateWishlistImage } from '@girae/common/ditto'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const line = (r: BulkDrawResult) =>
  ` ${r.card.rarityEmoji} \`${r.card.id}\`. **${escapeMarkdown(r.card.name)}** — _${escapeMarkdown(r.subcategoryName)}_ ${r.categoryEmoji}`

export async function renderBulkDrawSummary(
  results: BulkDrawResult[],
  opts: { splitFavorites: boolean },
): Promise<{ content: string; photoUrl?: string }> {
  if (results.length === 0) {
    return { content: 'Nenhum card foi sorteado dessa vez... tente novamente mais tarde. 😔' }
  }

  const count = results.length
  const header = `🎲 Você usou **${count}** giro${count === 1 ? '' : 's'}! Aqui está o que você ganhou:`

  let content: string
  let orderedForImage: BulkDrawResult[]

  if (opts.splitFavorites) {
    const favorites = results.filter(r => r.isFromFavorite)
    const others = results.filter(r => !r.isFromFavorite)
    content = `${header}\n\n**⭐ Cards das suas subs favoritas:**\n${favorites.length ? favorites.map(line).join('\n') : '_Nenhum._'}\n\n**🎴 Outros cards:**\n${others.length ? others.map(line).join('\n') : '_Nenhum._'}`
    orderedForImage = [...favorites, ...others]
  } else {
    content = `${header}\n\n${results.map(line).join('\n')}`
    orderedForImage = results
  }

  const dittoCards = orderedForImage
    .filter(r => r.card.imageUrl)
    .slice(0, 10)
    .map(r => ({ id: r.card.id, name: r.card.name, imageUrl: r.card.imageUrl! }))
  const image = dittoCards.length > 0 ? await generateWishlistImage(dittoCards) : null

  return { content, photoUrl: image?.url }
}
