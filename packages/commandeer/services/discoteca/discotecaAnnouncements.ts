import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { reply } from '@girae/common/dbos/messaging'
import { buildCtx } from '../syntheticCtx'
import { EMOJI } from '../../constants'
import { ANNOUNCEMENT_AUTHOR_ID, ANNOUNCEMENT_AUTHOR_NAME } from '../cards/contentAnnouncements'

const MAX_LISTED_ENTRIES = 30
const TYPE_EMOJI = { album: '💽', single: '🎵' } as const

interface AnnouncementEntry {
  id: number
  name: string
  type: 'single' | 'album'
  rarityEmoji: string
}

const entryLine = (entry: AnnouncementEntry): string =>
  `${entry.rarityEmoji} \`${entry.id}\`. **${escapeMarkdown(entry.name)}** ${TYPE_EMOJI[entry.type]}`

function entryListSection(entries: AnnouncementEntry[]): string {
  const shown = entries.slice(0, MAX_LISTED_ENTRIES)
  const lines = shown.map(entryLine)
  const remaining = entries.length - shown.length
  if (remaining > 0) lines.push(`...e mais ${remaining} título${remaining === 1 ? '' : 's'}.`)
  return lines.join('\n')
}

export interface NewArtistAnnouncement {
  id: number
  name: string
  imageUrl: string | null
  createdAt: Date
  entries: AnnouncementEntry[]
}

export function buildArtistAnnouncement(artist: NewArtistAnnouncement): { content: string; photoUrl?: string } {
  const date = format(artist.createdAt, 'dd/MM/yyyy', { locale: ptBR })
  const content = `${EMOJI.newContent} Adição de artista novo na Discoteca\n🎧 \`${artist.id}\`. **${escapeMarkdown(artist.name)}**\n\n${EMOJI.dice} **${artist.entries.length} título${artist.entries.length === 1 ? '' : 's'}** adicionados no total.\n${EMOJI.date} **${date}**\n\n${entryListSection(artist.entries)}`
  return { content, photoUrl: artist.imageUrl ?? undefined }
}

export interface NewEntriesGroupAnnouncement {
  artistId: number
  artistName: string
  entries: AnnouncementEntry[]
}

export function buildEntriesAnnouncement(group: NewEntriesGroupAnnouncement, schedTime: Date): { content: string } {
  const date = format(schedTime, 'dd/MM/yyyy', { locale: ptBR })
  const content = `${EMOJI.newContent} Adição de títulos novos na Discoteca\n🎧 **${escapeMarkdown(group.artistName)}**\n\n${EMOJI.dice} **${group.entries.length} título${group.entries.length === 1 ? '' : 's'}** adicionados no total.\n${EMOJI.date} **${date}**\n\n${entryListSection(group.entries)}`
  return { content }
}

interface UnannouncedEntryRow {
  id: number
  name: string
  type: 'single' | 'album'
  rarityEmoji: string
  artistId: number
  artistName: string
}

// rows arrive pre-ordered by artistId then rarity (DiscotecaDB.claimUnannouncedEntries), so a single pass groups them.
export function groupEntriesByArtist(rows: UnannouncedEntryRow[]): NewEntriesGroupAnnouncement[] {
  const groups: NewEntriesGroupAnnouncement[] = []
  const byArtist = new Map<number, NewEntriesGroupAnnouncement>()
  for (const row of rows) {
    let group = byArtist.get(row.artistId)
    if (!group) {
      group = { artistId: row.artistId, artistName: row.artistName, entries: [] }
      byArtist.set(row.artistId, group)
      groups.push(group)
    }
    group.entries.push({ id: row.id, name: row.name, type: row.type, rarityEmoji: row.rarityEmoji })
  }
  return groups
}

export async function announceNewArtist(chatId: string, threadId: string | undefined, artist: NewArtistAnnouncement): Promise<void> {
  const ctx = buildCtx('telegram', ANNOUNCEMENT_AUTHOR_ID, ANNOUNCEMENT_AUTHOR_NAME, chatId, threadId)
  await reply(ctx, buildArtistAnnouncement(artist))
}

export async function announceNewEntriesGroup(chatId: string, threadId: string | undefined, group: NewEntriesGroupAnnouncement, schedTime: Date): Promise<void> {
  const ctx = buildCtx('telegram', ANNOUNCEMENT_AUTHOR_ID, ANNOUNCEMENT_AUTHOR_NAME, chatId, threadId)
  await reply(ctx, buildEntriesAnnouncement(group, schedTime))
}
