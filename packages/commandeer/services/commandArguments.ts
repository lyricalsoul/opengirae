import { CommandArgumentType, type CommandArgumentSpec } from '@girae/common/commands'
import { reply, pageNavRow } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { VanitiesDB } from '@girae/database/vanities'
import { EconomyDB } from '@girae/database/economy'
import { DiscotecaDB } from '@girae/database/discoteca'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { normalizeText } from '@girae/common/utilities/normalizeText'
import { TYPE_LABEL } from './vanity/vanityBrowser'
import { isEmojiOnly } from './cards/cativeiro'
import { renderCardSearchResults } from '../commands/cards/card'

const GREEDY_TYPES = new Set([
  CommandArgumentType.STRING,
  CommandArgumentType.CARD,
  CommandArgumentType.CATEGORY,
  CommandArgumentType.SUBCATEGORY,
  CommandArgumentType.DISCOTECA_GENRE,
  CommandArgumentType.DISCOTECA_SUBCATEGORY,
  CommandArgumentType.DISCOTECA_ENTRY,
  CommandArgumentType.DISCOTECA_ARTIST,
  CommandArgumentType.VANITY_ITEM,
])

export function splitPositionalTokens(args: string[], specs: CommandArgumentSpec[], ctx?: IncomingCommand): (string | undefined)[] {
  let cursor = 0
  return specs.map((spec, i) => {
    if (spec.type === CommandArgumentType.USER_MENTION && ctx?.message.replyTo) return undefined

    const isLast = i === specs.length - 1
    const raw = (isLast && GREEDY_TYPES.has(spec.type))
      ? args.slice(cursor).join(' ').trim()
      : (args[cursor] ?? '').trim()
    cursor++
    return raw === '' ? undefined : raw
  })
}

export type ParseOutcome =
  | { ok: true; value: unknown }
  | { ok: false; message?: string; handled?: boolean }

function parseStrictId(raw: string): number | undefined {
  return /^-?\d+$/.test(raw) ? parseInt(raw, 10) : undefined
}

function parseNumber(raw: string): ParseOutcome {
  const n = parseStrictId(raw)
  return n === undefined ? { ok: false } : { ok: true, value: n }
}

const AMBIGUOUS_RESULTS_SHOWN = 15

// telegram caps messages at 4096 chars - a raw dump of up to 100 matches has hit that limit in prod
function ambiguousResultsMessage(lines: string[]): string {
  const shown = lines.slice(0, AMBIGUOUS_RESULTS_SHOWN)
  const rest = lines.length - shown.length
  const extra = rest > 0 ? `\n\n_e mais ${rest}..._` : ''
  return `🔎 **${lines.length}** resultados encontrados:\n\n${shown.join('\n')}${extra}\n\nUse o ID para especificar.`
}

export async function resolveCardByIdOrName(raw: string): Promise<ParseOutcome> {
  return parseCard(raw)
}

export async function resolveSubcategoryByIdOrName(raw: string): Promise<ParseOutcome> {
  return parseSubcategory(raw)
}

export async function resolveCategoryByIdOrName(raw: string): Promise<ParseOutcome> {
  return parseCategory(raw)
}

export async function resolveDiscotecaAlbumByIdOrName(raw: string): Promise<ParseOutcome> {
  return parseDiscotecaEntry(raw, 'album')
}

// no entryType - matches an album OR a single, for commands that don't care which.
export async function resolveDiscotecaEntryByIdOrName(raw: string): Promise<ParseOutcome> {
  return parseDiscotecaEntry(raw)
}

export async function resolveDiscotecaArtistByIdOrName(raw: string): Promise<ParseOutcome> {
  return parseDiscotecaArtist(raw)
}

async function parseCard(raw: string, ctx?: IncomingCommand, opts?: { paginatedAmbiguous?: boolean }): Promise<ParseOutcome> {
  const asId = parseStrictId(raw)
  if (asId !== undefined) {
    const card = await CardsDB.getCardWithDetails(asId)
    return card ? { ok: true, value: card } : { ok: false, message: 'Não encontrei um personagem com esse ID.' }
  }

  const byAlias = await CardsDB.getCardByAlias(raw)
  if (byAlias) {
    const card = await CardsDB.getCardWithDetails(byAlias.id)
    if (card) return { ok: true, value: card }
  }

  const results = await CardsDB.searchCardsByName(raw, 100)
  if (results.length === 0) return { ok: false, message: 'Não encontrei um personagem com esse nome.' }
  if (results.length > 1) {
    if (opts?.paginatedAmbiguous && ctx) {
      const rendered = await renderCardSearchResults(raw, 0)
      const navRow = pageNavRow('cardsearch', raw, 0, rendered.hasNext, rendered.totalPages)
      await reply(ctx, { content: rendered.content, buttonRows: navRow.length ? [navRow] : [] })
      return { ok: false, handled: true }
    }
    const lines = results.map(c => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** ${c.categoryEmoji ?? ''} _${escapeMarkdown(c.subcategoryName ?? '')}_`)
    return { ok: false, message: ambiguousResultsMessage(lines) }
  }

  const card = await CardsDB.getCardWithDetails(results[0]!.id)
  return card ? { ok: true, value: card } : { ok: false }
}

async function categoryNotFoundMessage(): Promise<string> {
  const categories = await CardsDB.getCategories()
  const list = categories.map(c => `${c.emoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**`).join('\n')
  return `Categoria não encontrada. As seguintes categorias estão disponíveis:\n\n${list}`
}

async function parseCategory(raw: string): Promise<ParseOutcome> {
  const asId = parseStrictId(raw)
  if (asId !== undefined) {
    const category = await CardsDB.getCategory(asId)
    return category ? { ok: true, value: category } : { ok: false, message: await categoryNotFoundMessage() }
  }

  // Accent-insensitive ("musica" must resolve "Música"); categories are few, so filter client-side.
  const normalizedQuery = normalizeText(raw)
  const allCategories = await CardsDB.getCategories()
  const results = allCategories.filter(c => normalizeText(c.name).includes(normalizedQuery))
  if (results.length === 0) return { ok: false, message: await categoryNotFoundMessage() }
  if (results.length > 1) {
    const exact = results.filter(c => normalizeText(c.name) === normalizedQuery)
    if (exact.length === 1) return { ok: true, value: exact[0] }
    const lines = results.map(c => `${c.emoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**`)
    return { ok: false, message: ambiguousResultsMessage(lines) }
  }

  return { ok: true, value: results[0] }
}

async function discotecaGenreNotFoundMessage(): Promise<string> {
  const genres = await DiscotecaDB.getGenres()
  const list = genres.map(g => `🎼 \`${g.id}\`. **${escapeMarkdown(g.name)}**`).join('\n')
  return `Gênero não encontrado. Os seguintes gêneros estão disponíveis:\n\n${list}`
}

async function parseDiscotecaGenre(raw: string): Promise<ParseOutcome> {
  const asId = parseStrictId(raw)
  if (asId !== undefined) {
    const genre = await DiscotecaDB.getGenre(asId)
    return genre ? { ok: true, value: genre } : { ok: false, message: await discotecaGenreNotFoundMessage() }
  }

  const normalizedQuery = normalizeText(raw)
  const allGenres = await DiscotecaDB.getGenres()
  const results = allGenres.filter(g => normalizeText(g.name).includes(normalizedQuery))
  if (results.length === 0) return { ok: false, message: await discotecaGenreNotFoundMessage() }
  if (results.length > 1) {
    const exact = results.filter(g => normalizeText(g.name) === normalizedQuery)
    if (exact.length === 1) return { ok: true, value: exact[0] }
    const lines = results.map(g => `🎼 \`${g.id}\`. **${escapeMarkdown(g.name)}**`)
    return { ok: false, message: ambiguousResultsMessage(lines) }
  }

  return { ok: true, value: results[0] }
}

async function discotecaSubcategoryNotFoundMessage(): Promise<string> {
  const subcategories = await DiscotecaDB.getSubcategories()
  const list = subcategories.map(s => `${s.emoji} \`${s.id}\`. **${escapeMarkdown(s.name)}**`).join('\n')
  return `Categoria não encontrada. As seguintes categorias estão disponíveis:\n\n${list}`
}

async function parseDiscotecaSubcategory(raw: string, subcategoryType?: 'album' | 'single'): Promise<ParseOutcome> {
  const asId = parseStrictId(raw)
  if (asId !== undefined) {
    const subcategory = await DiscotecaDB.getSubcategory(asId)
    if (!subcategory || (subcategoryType && subcategory.isAlbum !== (subcategoryType === 'album'))) return { ok: false, message: await discotecaSubcategoryNotFoundMessage() }
    return { ok: true, value: subcategory }
  }

  const normalizedQuery = normalizeText(raw)
  const allSubcategories = (await DiscotecaDB.getSubcategories()).filter(s => subcategoryType ? s.isAlbum === (subcategoryType === 'album') : true)
  const results = allSubcategories.filter(s => normalizeText(s.name).includes(normalizedQuery))
  if (results.length === 0) return { ok: false, message: await discotecaSubcategoryNotFoundMessage() }
  if (results.length > 1) {
    const exact = results.filter(s => normalizeText(s.name) === normalizedQuery)
    if (exact.length === 1) return { ok: true, value: exact[0] }
    const lines = results.map(s => `${s.emoji} \`${s.id}\`. **${escapeMarkdown(s.name)}**`)
    return { ok: false, message: ambiguousResultsMessage(lines) }
  }

  return { ok: true, value: results[0] }
}

async function parseDiscotecaEntry(raw: string, entryType?: 'album' | 'single'): Promise<ParseOutcome> {
  const notFoundByIdMessage = entryType === 'album' ? 'Não encontrei um álbum com esse ID.'
    : entryType === 'single' ? 'Não encontrei um single com esse ID.'
      : 'Não encontrei um item da Discoteca com esse ID.'
  const notFoundByNameMessage = entryType === 'album' ? 'Não encontrei um álbum com esse nome.'
    : entryType === 'single' ? 'Não encontrei um single com esse nome.'
      : 'Não encontrei um item da Discoteca com esse nome.'

  const asId = parseStrictId(raw)
  if (asId !== undefined) {
    const entry = await DiscotecaDB.getEntryWithDetails(asId)
    if (!entry || (entryType && entry.type !== entryType)) return { ok: false, message: notFoundByIdMessage }
    return { ok: true, value: entry }
  }

  const results = await DiscotecaDB.searchEntriesByName(raw, 100, entryType)
  if (results.length === 0) return { ok: false, message: notFoundByNameMessage }
  if (results.length > 1) {
    const lines = results.map(e => `${e.type === 'album' ? '💽' : '🎵'} \`${e.id}\`. **${escapeMarkdown(e.name)}** — ${escapeMarkdown(e.artistName)}`)
    return { ok: false, message: ambiguousResultsMessage(lines) }
  }

  const entry = await DiscotecaDB.getEntryWithDetails(results[0]!.id)
  return entry ? { ok: true, value: entry } : { ok: false }
}

async function discotecaArtistNotFoundMessage(): Promise<string> {
  return 'Artista não encontrado.'
}

async function parseDiscotecaArtist(raw: string): Promise<ParseOutcome> {
  const asId = parseStrictId(raw)
  if (asId !== undefined) {
    const artist = await DiscotecaDB.getArtist(asId)
    return artist ? { ok: true, value: artist } : { ok: false, message: await discotecaArtistNotFoundMessage() }
  }

  const results = await DiscotecaDB.searchArtistsByName(raw, 100)
  if (results.length === 0) return { ok: false, message: await discotecaArtistNotFoundMessage() }
  if (results.length > 1) {
    const lines = results.map(a => `🎧 \`${a.id}\`. **${escapeMarkdown(a.name)}**`)
    return { ok: false, message: ambiguousResultsMessage(lines) }
  }

  const artist = await DiscotecaDB.getArtist(results[0]!.id)
  return artist ? { ok: true, value: artist } : { ok: false }
}

async function parseVanityItem(raw: string, vanityType: 'background' | 'sticker', showBasePrice?: boolean): Promise<ParseOutcome> {
  const label = TYPE_LABEL[vanityType]
  const asId = parseStrictId(raw)
  if (asId !== undefined) {
    const item = await VanitiesDB.getStoreItemById(asId)
    return (item && item.type === vanityType) ? { ok: true, value: item } : { ok: false, message: `Não encontrei um ${label} com esse ID.` }
  }

  const results = await VanitiesDB.searchStoreItemsByType(vanityType, raw, 100)
  if (results.length === 0) return { ok: false, message: `Não encontrei um ${label} com esse nome.` }
  if (results.length > 1) {
    const lines = await Promise.all(results.map(async i => {
      const price = showBasePrice ? i.price : await EconomyDB.applyInflation(i.price)
      return `💸 \`${i.id}\`. **${escapeMarkdown(i.title)}** — ${price} moedas`
    }))
    return { ok: false, message: ambiguousResultsMessage(lines) }
  }

  const item = await VanitiesDB.getStoreItemById(results[0]!.id)
  return item ? { ok: true, value: item } : { ok: false }
}

const HEX_COLOR_REGEX = /^#?[0-9a-fA-F]{6}$/

function parseHexColor(raw: string): ParseOutcome {
  if (!HEX_COLOR_REGEX.test(raw)) return { ok: false, message: 'Não consegui encontrar um código HEX válido. 😔' }
  return { ok: true, value: raw.startsWith('#') ? raw : `#${raw}` }
}

const TRUE_TOKENS = new Set(['yes', 'sim', '1', 'on', 'ativar'])
const FALSE_TOKENS = new Set(['no', 'nao', 'não', '0', 'off', 'desativar'])

const CUSTOM_EMOJI_WIRE_TAG_REGEX = /^<tg-emoji:(\d+)>(.+)<\/tg-emoji>$/

function parseEmoji(raw: string): ParseOutcome {
  const trimmed = raw.trim()
  const wireMatch = trimmed.match(CUSTOM_EMOJI_WIRE_TAG_REGEX)
  if (wireMatch) return { ok: true, value: `<tg-emoji emoji-id="${wireMatch[1]}">${wireMatch[2]}</tg-emoji>` }
  if (isEmojiOnly(trimmed)) return { ok: true, value: trimmed }
  return { ok: false, message: '🤔 Manda um emoji de verdade, por favor.' }
}

function parseBoolean(raw: string): ParseOutcome {
  const normalized = raw.toLowerCase()
  if (TRUE_TOKENS.has(normalized)) return { ok: true, value: true }
  if (FALSE_TOKENS.has(normalized)) return { ok: true, value: false }
  return { ok: false }
}

async function parseSubcategory(raw: string): Promise<ParseOutcome> {
  const asId = parseStrictId(raw)
  if (asId !== undefined) {
    const subcategory = await CardsDB.getSubcategory(asId)
    return subcategory ? { ok: true, value: subcategory } : { ok: false, message: 'Não encontrei uma subcategoria com esse ID.' }
  }

  const byAlias = await CardsDB.getSubcategoryByAlias(raw)
  if (byAlias) return { ok: true, value: byAlias }

  const results = await CardsDB.searchSubcategoriesByName(raw, 100)
  if (results.length === 0) return { ok: false, message: 'Não encontrei uma subcategoria com esse nome.' }
  if (results.length > 1) {
    const lines = results.map(s => `${s.categoryEmoji} \`${s.id}\`. **${escapeMarkdown(s.name)}**`)
    return { ok: false, message: ambiguousResultsMessage(lines) }
  }

  const subcategory = await CardsDB.getSubcategory(results[0]!.id)
  return subcategory ? { ok: true, value: subcategory } : { ok: false }
}

async function parseUserMention(raw: string | undefined, ctx: IncomingCommand): Promise<ParseOutcome> {
  const replyToId = ctx.message.replyTo?.author.id
  if (replyToId) return { ok: true, value: replyToId }
  if (!raw) return { ok: false }

  if (raw.startsWith('@')) {
    const username = raw.slice(1)
    const user = await UsersDB.getUserByUsername(username)
    if (!user) return { ok: false, message: `Não encontrei o usuário @${escapeMarkdown(username)}.` }

    const platformId = await UsersDB.getPlatformIdForUser(user.id, ctx.message.platform as 'telegram' | 'discord')
    return platformId
      ? { ok: true, value: platformId }
      : { ok: false, message: `@${escapeMarkdown(username)} não tem uma conta vinculada nesta plataforma.` }
  }

  if (/^\d+$/.test(raw)) {
    if (raw.length >= 16) return { ok: true, value: raw }

    const user = await UsersDB.getUserById(parseInt(raw, 10))
    if (!user) return { ok: false, message: `Não encontrei o usuário com ID ${raw}.` }

    const platformId = await UsersDB.getPlatformIdForUser(user.id, ctx.message.platform as 'telegram' | 'discord')
    return platformId
      ? { ok: true, value: platformId }
      : { ok: false, message: `O usuário ${raw} não tem uma conta vinculada nesta plataforma.` }
  }

  return { ok: false }
}

async function parseValue(spec: CommandArgumentSpec, raw: string | undefined, ctx: IncomingCommand): Promise<ParseOutcome> {
  if (spec.type === CommandArgumentType.USER_MENTION) return parseUserMention(raw, ctx)
  if (raw === undefined) return { ok: false }

  switch (spec.type) {
    case CommandArgumentType.NUMBER: return parseNumber(raw)
    case CommandArgumentType.STRING: return { ok: true, value: raw }
    case CommandArgumentType.HEX_COLOR: return parseHexColor(raw)
    case CommandArgumentType.BOOLEAN: return parseBoolean(raw)
    case CommandArgumentType.EMOJI: return parseEmoji(raw)
    case CommandArgumentType.CARD: return parseCard(raw, ctx, { paginatedAmbiguous: spec.paginatedAmbiguous })
    case CommandArgumentType.CATEGORY: return parseCategory(raw)
    case CommandArgumentType.SUBCATEGORY: return parseSubcategory(raw)
    case CommandArgumentType.DISCOTECA_GENRE: return parseDiscotecaGenre(raw)
    case CommandArgumentType.DISCOTECA_SUBCATEGORY: return parseDiscotecaSubcategory(raw, spec.subcategoryType)
    case CommandArgumentType.DISCOTECA_ENTRY: return parseDiscotecaEntry(raw, spec.entryType)
    case CommandArgumentType.DISCOTECA_ARTIST: return parseDiscotecaArtist(raw)
    case CommandArgumentType.VANITY_ITEM: return parseVanityItem(raw, spec.vanityType, spec.showBasePrice)
  }
}

export type CommandArgumentResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; message?: string; handled?: boolean }

export async function parseCommandArguments(
  specs: CommandArgumentSpec[],
  args: string[],
  ctx: IncomingCommand,
): Promise<CommandArgumentResult> {
  const tokens = splitPositionalTokens(args, specs, ctx)
  const values: Record<string, unknown> = {}

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!
    const raw = tokens[i]

    if (raw === undefined && spec.type !== CommandArgumentType.USER_MENTION) {
      if (spec.nullable) { values[spec.name] = undefined; continue }
      return { ok: false }
    }

    const outcome = await parseValue(spec, raw, ctx)
    if (!outcome.ok) {
      if (outcome.message || outcome.handled) return { ok: false, message: outcome.message, handled: outcome.handled }
      if (spec.nullable) { values[spec.name] = undefined; continue }
      return { ok: false }
    }

    if (spec.guard) {
      const guardResult = await spec.guard(outcome.value, ctx)
      if (guardResult === false) return { ok: false }
      if (typeof guardResult === 'string') return { ok: false, message: guardResult }
    }

    values[spec.name] = outcome.value
  }

  return { ok: true, values }
}

export async function resolveCommandArguments(
  specs: CommandArgumentSpec[],
  ctx: IncomingCommand,
  usage: string,
): Promise<Record<string, unknown> | null> {
  const result = await parseCommandArguments(specs, ctx.args, ctx)
  if (result.ok) return result.values

  if (!result.handled) await reply(ctx, result.message ?? `Uso: \`${usage}\``)
  return null
}
