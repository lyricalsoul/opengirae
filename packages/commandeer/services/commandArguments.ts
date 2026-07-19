import { CommandArgumentType, type CommandArgumentSpec } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { VanitiesDB } from '@girae/database/vanities'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { TYPE_LABEL } from './vanityBrowser'

const GREEDY_TYPES = new Set([
  CommandArgumentType.STRING,
  CommandArgumentType.CARD,
  CommandArgumentType.CATEGORY,
  CommandArgumentType.SUBCATEGORY,
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
  | { ok: false; message?: string }

function parseNumber(raw: string): ParseOutcome {
  const n = parseInt(raw, 10)
  return isNaN(n) ? { ok: false } : { ok: true, value: n }
}

export async function resolveCardByIdOrName(raw: string): Promise<ParseOutcome> {
  return parseCard(raw)
}

async function parseCard(raw: string): Promise<ParseOutcome> {
  const asId = parseInt(raw, 10)
  if (!isNaN(asId)) {
    const card = await CardsDB.getCardWithDetails(asId)
    return card ? { ok: true, value: card } : { ok: false, message: 'Não encontrei um personagem com esse ID.' }
  }

  const results = await CardsDB.searchCardsByName(raw, 100)
  if (results.length === 0) return { ok: false, message: 'Não encontrei um personagem com esse nome.' }
  if (results.length > 1) {
    const list = results.map(c => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** ${c.categoryEmoji ?? ''} _${escapeMarkdown(c.subcategoryName ?? '')}_`).join('\n')
    return { ok: false, message: `🔎 **${results.length}** resultados encontrados:\n\n${list}\n\nUse o ID para especificar.` }
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
  const asId = parseInt(raw, 10)
  if (!isNaN(asId)) {
    const category = await CardsDB.getCategory(asId)
    return category ? { ok: true, value: category } : { ok: false, message: await categoryNotFoundMessage() }
  }

  const results = await CardsDB.searchCategoriesByName(raw, 100)
  if (results.length === 0) return { ok: false, message: await categoryNotFoundMessage() }
  if (results.length > 1) {
    const list = results.map(c => `${c.emoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**`).join('\n')
    return { ok: false, message: `🔎 **${results.length}** resultados encontrados:\n\n${list}\n\nUse o ID para especificar.` }
  }

  const category = await CardsDB.getCategory(results[0]!.id)
  return category ? { ok: true, value: category } : { ok: false }
}

async function parseVanityItem(raw: string, vanityType: 'background' | 'sticker'): Promise<ParseOutcome> {
  const label = TYPE_LABEL[vanityType]
  const asId = parseInt(raw, 10)
  if (!isNaN(asId)) {
    const item = await VanitiesDB.getStoreItemById(asId)
    return (item && item.type === vanityType) ? { ok: true, value: item } : { ok: false, message: `Não encontrei um ${label} com esse ID.` }
  }

  const results = await VanitiesDB.searchStoreItemsByType(vanityType, raw, 100)
  if (results.length === 0) return { ok: false, message: `Não encontrei um ${label} com esse nome.` }
  if (results.length > 1) {
    const list = results.map(i => `💸 \`${i.id}\`. **${escapeMarkdown(i.title)}** — ${i.price} moedas`).join('\n')
    return { ok: false, message: `🔎 **${results.length}** resultados encontrados:\n\n${list}\n\nUse o ID para especificar.` }
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

function parseBoolean(raw: string): ParseOutcome {
  const normalized = raw.toLowerCase()
  if (TRUE_TOKENS.has(normalized)) return { ok: true, value: true }
  if (FALSE_TOKENS.has(normalized)) return { ok: true, value: false }
  return { ok: false }
}

async function parseSubcategory(raw: string): Promise<ParseOutcome> {
  const asId = parseInt(raw, 10)
  if (!isNaN(asId)) {
    const subcategory = await CardsDB.getSubcategory(asId)
    return subcategory ? { ok: true, value: subcategory } : { ok: false, message: 'Não encontrei uma subcategoria com esse ID.' }
  }

  const byAlias = await CardsDB.getSubcategoryByAlias(raw)
  if (byAlias) return { ok: true, value: byAlias }

  const results = await CardsDB.searchSubcategoriesByName(raw, 100)
  if (results.length === 0) return { ok: false, message: 'Não encontrei uma subcategoria com esse nome.' }
  if (results.length > 1) {
    const list = results.map(s => `${s.categoryEmoji} \`${s.id}\`. **${escapeMarkdown(s.name)}**`).join('\n')
    return { ok: false, message: `🔎 **${results.length}** resultados encontrados:\n\n${list}\n\nUse o ID para especificar.` }
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

    // user.telegramId is stale for post-migration users - resolve on the asker's platform instead.
    const platformId = await UsersDB.getPlatformIdForUser(user.id, ctx.message.platform as 'telegram' | 'discord')
    return platformId
      ? { ok: true, value: platformId }
      : { ok: false, message: `@${escapeMarkdown(username)} não tem uma conta vinculada nesta plataforma.` }
  }

  if (/^\d+$/.test(raw)) return { ok: true, value: raw }
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
    case CommandArgumentType.CARD: return parseCard(raw)
    case CommandArgumentType.CATEGORY: return parseCategory(raw)
    case CommandArgumentType.SUBCATEGORY: return parseSubcategory(raw)
    case CommandArgumentType.VANITY_ITEM: return parseVanityItem(raw, spec.vanityType)
  }
}

export type CommandArgumentResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; message?: string }

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
      if (outcome.message) return { ok: false, message: outcome.message }
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

  await reply(ctx, result.message ?? `Uso: \`${usage}\``)
  return null
}
