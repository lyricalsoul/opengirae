import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { AuditDB } from '@girae/database/audit'
import { UsersDB } from '@girae/database/users'
import { reply } from '@girae/common/dbos/messaging'
import type { ButtonSpec } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'
import { EMOJI } from '../../constants'

const DEFAULT_LIMIT_PER_DIRECTION = 5
const PAIR_PAGE_SIZE = 15

type DonationRow = Awaited<ReturnType<typeof AuditDB.getDiscotecaDonationHistory>>['rows'][number]
type BotPlatform = 'telegram' | 'discord'

function formatDate(iso: string | Date): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('pt-BR')
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${date} às ${time}`
}

// clickable mention when linked on this platform, plain escaped name otherwise.
function nameOrMention(platform: BotPlatform, platformId: string | null, name: string | null): string {
  if (!name) return 'usuário removido'
  return platformId ? mention(platform, platformId, name) : escapeMarkdown(name)
}

function renderEntry(row: DonationRow, platform: BotPlatform): string {
  const otherPartyLabel = row.direction === 'sent' ? 'Para' : 'De'
  const otherPartyName = row.direction === 'sent'
    ? nameOrMention(platform, row.recipientPlatformId, row.recipientName)
    : nameOrMention(platform, row.donorPlatformId, row.donorName)
  const entriesLine = row.action === 'discoteca.doarclc'
    ? `Discografia inteira de **${escapeMarkdown(row.artistName ?? 'artista removido')}** (${row.entries.length} item(ns))`
    : row.entries.map(e => `${e.type === 'album' ? '💽' : '🎵'} ${escapeMarkdown(e.name)}${e.count > 1 ? ` (${e.count}x)` : ''}`).join(', ') || `${row.entries.length} item(ns)`
  const statusLine = row.revertedAt
    ? `↩️ revertida por **${nameOrMention(platform, row.revertedByAdminPlatformId, row.revertedByAdminName)}** em ${formatDate(row.revertedAt)}`
    : `Pra cancelar: \`/doacaocancelardisco ${row.id}\``

  return [
    `\`#${row.id}\` · ${EMOJI.date} ${formatDate(row.createdAt)}`,
    `↳ **${otherPartyLabel}:** ${otherPartyName}`,
    `↳ 💱 ${entriesLine}`,
    `↳ ${statusLine}`,
  ].join('\n')
}

function renderSection(title: string, emoji: string, rows: DonationRow[], total: number, limit: number, platform: BotPlatform): string {
  const countNote = total > limit ? ` (últimas ${limit} de ${total})` : ` (${total})`
  return `${emoji} **${title}**${countNote}\n\n${rows.map(r => renderEntry(r, platform)).join('\n\n')}`
}

// runCommand buttons (not @Page) so isAdmin is re-checked on every click - @Page callbacks are resolved globally and never re-check guards, which would let a forged click page through anyone's history.
function buildPairNavButtons(target: string, target2: string, page: number, totalPages: number): ButtonSpec[] {
  const runCommand = (p: number) => ({ runCommand: { name: 'doacoesdisco', args: [target, target2, String(p)] } })
  return [
    ...(page > 1 ? [{ text: '⏮️', ...runCommand(1) }] : []),
    ...(page > 1 ? [{ text: '⬅️', ...runCommand(page - 1) }] : []),
    ...(page < totalPages ? [{ text: '➡️', ...runCommand(page + 1) }] : []),
    ...(totalPages - page > 1 ? [{ text: '⏭️', ...runCommand(totalPages) }] : []),
  ]
}

// page only applies once both users are given, so it can't be confused with a 2nd USER_MENTION.
export default class DoacoesDiscoCommand extends Command {
  static override info = {
    guards: ['isAdmin'],
    name: 'doacoesdisco',
    description: 'Doações de Discoteca que um usuário recebeu/mandou (5+5 mais recentes), ou todas as doações entre dois usuários específicos (staff)',
    usage: '/doacoesdisco @usuário|ID [@usuário2|ID2 [página]] (ou em resposta ao usuário)',
  }

  @CommandArgument([
    { name: 'target', type: CommandArgumentType.USER_MENTION },
    { name: 'target2', type: CommandArgumentType.USER_MENTION, nullable: true },
    { name: 'page', type: CommandArgumentType.NUMBER, nullable: true, description: 'página (só junto com o segundo usuário)' },
  ])
  static override async execute(ctx: IncomingCommand, args: { target: string; target2?: string; page?: number }) {
    const platform = ctx.message.platform as BotPlatform
    const [target, target2] = await Promise.all([
      UsersDB.getUserByPlatformAccount(platform, args.target),
      args.target2 !== undefined ? UsersDB.getUserByPlatformAccount(platform, args.target2) : Promise.resolve(undefined),
    ])
    if (!target || (args.target2 !== undefined && !target2)) {
      await reply(ctx, '📛 Perfil ou perfis que inseriu não existem.')
      return
    }
    const targetMention = mention(platform, args.target, target.displayName)

    if (args.target2 !== undefined && target2) {
      if (target2.id === target.id) {
        await reply(ctx, '⚠️ **Aviso:** Os dois usuários são a mesma pessoa. Escolha usuários diferentes para realizar a comparação.')
        return
      }
      const target2Mention = mention(platform, args.target2, target2.displayName)

      const page = Math.max(1, args.page ?? 1)
      const { rows, total } = await AuditDB.getDiscotecaDonationHistory(target.id, {
        limit: PAIR_PAGE_SIZE, offset: (page - 1) * PAIR_PAGE_SIZE, withUserId: target2.id, platform,
      })
      if (total === 0) {
        await reply(ctx, `📦 Nenhuma doação da Discoteca entre ${targetMention} e ${target2Mention}.`)
        return
      }

      const totalPages = Math.max(1, Math.ceil(total / PAIR_PAGE_SIZE))
      if (rows.length === 0) {
        await reply(ctx, `${EMOJI.page} Essa página não existe - só tem **${totalPages}** no total.`)
        return
      }

      const pageInfo = totalPages > 1 ? `\n\n${EMOJI.page} Página \`${page}\` de **${totalPages}** (${total} no total)` : ''
      const navButtons = buildPairNavButtons(args.target, args.target2, page, totalPages)

      await reply(ctx, {
        content: `📦 **Histórico de Doações (Discoteca)** — ${targetMention} ↔ ${target2Mention}\n\n${rows.map(r => renderEntry(r, platform)).join('\n\n')}${pageInfo}`,
        buttons: navButtons.length > 0 ? navButtons : undefined,
      })
      return
    }

    const [sent, received] = await Promise.all([
      AuditDB.getDiscotecaDonationHistory(target.id, { limit: DEFAULT_LIMIT_PER_DIRECTION, direction: 'sent', platform }),
      AuditDB.getDiscotecaDonationHistory(target.id, { limit: DEFAULT_LIMIT_PER_DIRECTION, direction: 'received', platform }),
    ])

    if (sent.total === 0 && received.total === 0) {
      await reply(ctx, `📦 ${targetMention} não tem nenhuma doação da Discoteca registrada.`)
      return
    }

    const sections = [
      sent.rows.length > 0 ? renderSection('Doações Feitas', '📤', sent.rows, sent.total, DEFAULT_LIMIT_PER_DIRECTION, platform) : undefined,
      received.rows.length > 0 ? renderSection('Doações Recebidas', '📥', received.rows, received.total, DEFAULT_LIMIT_PER_DIRECTION, platform) : undefined,
    ].filter((s): s is string => s !== undefined)

    // target.id (short) instead of args.target, which can be a huge raw platform id.
    const hint = `\n\n${EMOJI.search} \`/doacoesdisco ${target.id} <ID ou @outro usuário>\` mostra todas as doações entre os dois.`

    await reply(ctx, `📦 **Histórico de Doações (Discoteca)** — ${targetMention}\n\n${sections.join('\n\n')}${hint}`)
  }
}
