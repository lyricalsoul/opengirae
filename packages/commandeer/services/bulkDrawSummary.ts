import type { BulkDrawResult } from '@girae/database/gacha'
import { generateWishlistImage } from '@girae/common/ditto'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { rawClient } from '@girae/common/queue'
import { EMOJI } from '../constants'

const PAGE_SIZE = 10
const SUMMARY_CACHE_TTL_SECONDS = 10 * 60

const line = (r: BulkDrawResult) =>
  `${r.isFromFavorite ? '⭐ ' : ''}${r.card.rarityEmoji} \`${r.card.id}\`. **${escapeMarkdown(r.card.name)}** _${escapeMarkdown(r.subcategoryName)}_${r.categoryEmoji ? ` ${r.categoryEmoji}` : ''}`

export interface BulkDrawSummaryData {
  header: string
  ordered: BulkDrawResult[]
  photoUrl?: string
}

export async function buildBulkDrawSummary(
  results: BulkDrawResult[],
  opts: { splitFavorites: boolean },
): Promise<BulkDrawSummaryData> {
  const count = results.length
  const header = count === 0
    ? 'Nenhum card foi sorteado dessa vez... tente novamente mais tarde. 😔'
    : `🎲 Você usou **${count}** giro${count === 1 ? '' : 's'}! Aqui está o que você ganhou:`

  const ordered = opts.splitFavorites
    ? [...results.filter(r => r.isFromFavorite), ...results.filter(r => !r.isFromFavorite)]
    : results

  const dittoCards = ordered
    .filter(r => r.card.imageUrl)
    .slice(0, 10)
    .map(r => ({ id: r.card.id, name: r.card.name, imageUrl: r.card.imageUrl! }))
  const image = dittoCards.length > 0 ? await generateWishlistImage(dittoCards) : null

  return { header, ordered, photoUrl: image?.url }
}

export function renderBulkDrawSummaryPage(data: BulkDrawSummaryData, page: number) {
  const totalPages = Math.max(1, Math.ceil(data.ordered.length / PAGE_SIZE))
  const slice = data.ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const pageInfo = totalPages > 1 ? `\n\n${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**` : ''
  const content = data.ordered.length === 0
    ? data.header
    : `${data.header}\n\n${slice.map(line).join('\n')}${pageInfo}`

  return { content, photoUrl: data.photoUrl, hasNext: page < totalPages - 1, totalPages }
}

const summaryCacheKey = (runId: string) => `bulkDrawSummary:${runId}`

export async function cacheBulkDrawSummary(runId: string, data: BulkDrawSummaryData): Promise<void> {
  await rawClient.set(summaryCacheKey(runId), JSON.stringify(data), { EX: SUMMARY_CACHE_TTL_SECONDS })
}

export async function loadBulkDrawSummary(runId: string): Promise<BulkDrawSummaryData | null> {
  const raw = await rawClient.get(summaryCacheKey(runId))
  return raw ? JSON.parse(raw) : null
}
