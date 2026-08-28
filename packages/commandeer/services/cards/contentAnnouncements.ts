import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { reply } from '@girae/common/dbos/messaging'
import { buildCtx } from '../syntheticCtx'
import { EMOJI } from '../../constants'

const MAX_LISTED_CARDS = 30
// synthetic author for a cron-originated message; also used by vanityAnnouncements.ts (same cron tick)
export const ANNOUNCEMENT_AUTHOR_ID = '0'
export const ANNOUNCEMENT_AUTHOR_NAME = 'openGIRAÊ'

interface AnnouncementCard {
  id: number
  name: string
  rarityEmoji: string
}

const cardLine = (card: AnnouncementCard): string =>
  `${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**`

function cardListSection(cardsList: AnnouncementCard[]): string {
  const shown = cardsList.slice(0, MAX_LISTED_CARDS)
  const lines = shown.map(cardLine)
  const remaining = cardsList.length - shown.length
  if (remaining > 0) lines.push(`...e mais ${remaining} card${remaining === 1 ? '' : 's'}.`)
  return lines.join('\n')
}

export interface NewSubcategoryAnnouncement {
  id: number
  name: string
  categoryEmoji: string
  imageUrl: string | null
  createdAt: Date
  cards: AnnouncementCard[]
}

export function buildSubcategoryAnnouncement(subcategory: NewSubcategoryAnnouncement): { content: string; photoUrl?: string } {
  const date = format(subcategory.createdAt, 'dd/MM/yyyy', { locale: ptBR })
  const content = `${EMOJI.newContent} Adição de coleção nova\n${subcategory.categoryEmoji} \`${subcategory.id}\`. **${escapeMarkdown(subcategory.name)}**\n\n${EMOJI.dice} **${subcategory.cards.length} cards** adicionados no total.\n${EMOJI.date} **${date}**\n\n${cardListSection(subcategory.cards)}`
  return { content, photoUrl: subcategory.imageUrl ?? undefined }
}

export interface NewCardsGroupAnnouncement {
  subcategoryId: number
  subcategoryName: string
  subcategoryEmoji: string
  subcategoryImageUrl: string | null
  cards: AnnouncementCard[]
}

export function buildCardsAnnouncement(group: NewCardsGroupAnnouncement, schedTime: Date): { content: string; photoUrl?: string } {
  const date = format(schedTime, 'dd/MM/yyyy', { locale: ptBR })
  const content = `${EMOJI.newContent} Adição de cards novos\n${group.subcategoryEmoji} \`${group.subcategoryId}\`. **${escapeMarkdown(group.subcategoryName)}**\n\n${EMOJI.dice} **${group.cards.length} cards** adicionados no total.\n${EMOJI.date} **${date}**\n\n${cardListSection(group.cards)}`
  return { content, photoUrl: group.subcategoryImageUrl ?? undefined }
}

interface UnannouncedCardRow {
  id: number
  name: string
  rarityEmoji: string
  subcategoryId: number
  subcategoryName: string
  subcategoryEmoji: string
  subcategoryImageUrl: string | null
}

// rows arrive pre-ordered by subcategoryId then rarity (CardsDB.claimUnannouncedCards), so a single pass groups them.
export function groupCardsBySubcategory(rows: UnannouncedCardRow[]): NewCardsGroupAnnouncement[] {
  const groups: NewCardsGroupAnnouncement[] = []
  const bySubcategory = new Map<number, NewCardsGroupAnnouncement>()
  for (const row of rows) {
    let group = bySubcategory.get(row.subcategoryId)
    if (!group) {
      group = {
        subcategoryId: row.subcategoryId,
        subcategoryName: row.subcategoryName,
        subcategoryEmoji: row.subcategoryEmoji,
        subcategoryImageUrl: row.subcategoryImageUrl,
        cards: [],
      }
      bySubcategory.set(row.subcategoryId, group)
      groups.push(group)
    }
    group.cards.push({ id: row.id, name: row.name, rarityEmoji: row.rarityEmoji })
  }
  return groups
}

export async function announceNewSubcategory(chatId: string, threadId: string | undefined, subcategory: NewSubcategoryAnnouncement): Promise<void> {
  const ctx = buildCtx('telegram', ANNOUNCEMENT_AUTHOR_ID, ANNOUNCEMENT_AUTHOR_NAME, chatId, threadId)
  await reply(ctx, buildSubcategoryAnnouncement(subcategory))
}

export async function announceNewCardsGroup(chatId: string, threadId: string | undefined, group: NewCardsGroupAnnouncement, schedTime: Date): Promise<void> {
  const ctx = buildCtx('telegram', ANNOUNCEMENT_AUTHOR_ID, ANNOUNCEMENT_AUTHOR_NAME, chatId, threadId)
  await reply(ctx, buildCardsAnnouncement(group, schedTime))
}
