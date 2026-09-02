import { Command, Subcommand, Page } from '@girae/common/commands'
import { reply, pageNavRow } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { UsersDB } from '@girae/database/users'
import { RankDB, type RankEntry, type CativeiroRankEntry, type RankPosition } from '@girae/database/rank'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'
import { resolveDisplayEmoji } from '@girae/common/utilities/customEmoji'

const PAGE_SIZE = 10

type RankType = 'rep' | 'dinheiro' | 'cards' | 'cativeiros' | 'maiscat'

const RANK_META: Record<RankType, { title: string; emoji: string; suffix: (v: number) => string }> = {
  rep: { title: 'Ranking de Reputação', emoji: '🌠', suffix: v => `${v} pts` },
  dinheiro: { title: 'Ranking de Dinheiro', emoji: '💰', suffix: v => `${v} moedas` },
  cards: { title: 'Ranking de Cartas', emoji: '🃏', suffix: v => `${v} cartas` },
  cativeiros: { title: 'Ranking de Cativeiros', emoji: '❤️‍🔥', suffix: v => `${v}x` },
  maiscat: { title: 'Ranking de Mais Cativeiros', emoji: '👑', suffix: v => `${v} cativeiros` },
}

type PrivacyRow = { userId: number; displayName: string; privacyMode: boolean; platformId: string | null }

function nameFor(row: PrivacyRow, viewerId: number, platform: 'telegram' | 'discord'): string {
  const inner = UsersDB.isViewable(viewerId, { id: row.userId, privacyMode: row.privacyMode }) && row.platformId
    ? mention(platform, row.platformId, row.displayName)
    : escapeMarkdown(row.displayName)
  return `**${inner}**`
}

function marker(position: number): string {
  return `${position}.`
}

async function renderPage(type: RankType, page: number, viewerTelegramId: string, platform: 'telegram' | 'discord') {
  const viewer = await UsersDB.getUserByPlatformAccount(platform, viewerTelegramId)
  if (!viewer) return null

  const offset = page * PAGE_SIZE
  const meta = RANK_META[type]
  let rows: string[]
  let total: number
  let position: RankPosition | undefined

  if (type === 'cativeiros') {
    const [entries, pos] = await Promise.all([
      RankDB.getTopByCativeiro(platform, PAGE_SIZE, offset),
      RankDB.getCativeiroPosition(viewer.id),
    ])
    total = entries[0]?.total ?? 0
    position = pos
    rows = entries.map((e: CativeiroRankEntry, i: number) => {
      const emoji = resolveDisplayEmoji(e.customEmoji, e.rarityEmoji, platform === 'telegram')
      return `${marker(offset + i + 1)} ${nameFor(e, viewer.id, platform)} — \`${e.cardId}\`. ${emoji} _${escapeMarkdown(e.cardName)}_ \`x${e.count}\``
    })
  } else {
    const fetchers: Record<Exclude<RankType, 'cativeiros'>, typeof RankDB.getTopByReputation> = {
      rep: RankDB.getTopByReputation,
      dinheiro: RankDB.getTopByCoins,
      cards: RankDB.getTopByCardCount,
      maiscat: RankDB.getTopByCativeiroCount,
    }
    const positionFetchers: Record<Exclude<RankType, 'cativeiros'>, typeof RankDB.getReputationPosition> = {
      rep: RankDB.getReputationPosition,
      dinheiro: RankDB.getCoinsPosition,
      cards: RankDB.getCardCountPosition,
      maiscat: RankDB.getCativeiroCountPosition,
    }
    const [entries, pos] = await Promise.all([
      fetchers[type](platform, PAGE_SIZE, offset),
      positionFetchers[type](viewer.id),
    ])
    total = entries[0]?.total ?? 0
    position = pos
    rows = entries.map((e: RankEntry, i: number) => `${marker(offset + i + 1)} ${nameFor(e, viewer.id, platform)} — ${meta.suffix(e.value)}`)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const positionLine = position ? `\n\n${meta.emoji} Você está em **#${position.rank}** de ${position.total}, com ${meta.suffix(position.value)}.` : ''
  const pageInfo = totalPages > 1 ? `\n\n📃 Página \`${page + 1}\` de **${totalPages}**` : ''
  const body = rows.length > 0 ? rows.join('\n') : '_Ninguém por aqui ainda._'

  return {
    content: `${meta.emoji} **${meta.title}**\n\n${body}${pageInfo}${positionLine}`,
    hasNext: page < totalPages - 1,
    totalPages,
  }
}

export default class RankCommand extends Command {
  static override info = {
    name: 'rank',
    description: 'Mostra os rankings da Giraê',
    usage: '/rank <rep|dinheiro|cards|cativeiros|maiscat>',
    aliases: ['ranking', 'top'],
  }

  static override async execute(ctx: IncomingCommand) {
    await reply(ctx, `Uso: \`${this.info.usage}\``)
  }

  @Subcommand({ name: 'rep', description: 'Ranking de reputação' })
  static async rep(ctx: IncomingCommand) {
    await RankCommand.showPage('rep', ctx)
  }

  @Subcommand({ name: 'dinheiro', description: 'Ranking de dinheiro', aliases: ['coins', 'moedas'] })
  static async dinheiro(ctx: IncomingCommand) {
    await RankCommand.showPage('dinheiro', ctx)
  }

  @Subcommand({ name: 'cards', description: 'Ranking de cartas', aliases: ['cartas'] })
  static async cards(ctx: IncomingCommand) {
    await RankCommand.showPage('cards', ctx)
  }

  @Subcommand({ name: 'cativeiros', description: 'Ranking de cards mais repetidos' })
  static async cativeiros(ctx: IncomingCommand) {
    await RankCommand.showPage('cativeiros', ctx)
  }

  @Subcommand({ name: 'maiscat', description: 'Ranking de quantidade de cativeiros' })
  static async maiscat(ctx: IncomingCommand) {
    await RankCommand.showPage('maiscat', ctx)
  }

  static async showPage(type: RankType, ctx: IncomingCommand) {
    const platform = ctx.message.platform as 'telegram' | 'discord'
    const page = await renderPage(type, 0, ctx.message.author.id, platform)
    if (!page) return

    const navRow = pageNavRow('rank', type, 0, page.hasNext, page.totalPages)
    await reply(ctx, {
      content: page.content,
      buttonRows: navRow.length ? [navRow] : undefined,
    })
  }

  @Page({ name: 'rank', restricted: true })
  static async rankPage(arg: string, page: number, authorId: string, platform: 'telegram' | 'discord') {
    return renderPage(arg as RankType, page, authorId, platform)
  }
}
