import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { DONATION_REVERT_PENALTY_COINS } from '@girae/database/cards'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'doacaocancelardisco:confirm'

// mirrors AuditDB's DiscotecaDonationRevertPenalty['penalty'] values.
const PENALTY_LABEL: Record<string, string> = {
  entry_returned: 'o mesmo item',
  draw_taken: '1 giro',
  coins_taken: `${DONATION_REVERT_PENALTY_COINS} moedas`,
  same_tier_entry_taken: 'outro item do mesmo tier',
}

export default class DoacaoCancelarDiscoCommand extends Command {
  static override info = {
    guards: ['isAdmin'],
    name: 'doacaocancelardisco',
    description: 'Reverte uma doação da Discoteca (/doardisco ou /doarclcdisco) - o ID vem do histórico de doações (staff)',
    usage: '/doacaocancelardisco <ID da doação>',
    aliases: ['canceladoacaodisco'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'auditLogId', type: CommandArgumentType.NUMBER, description: 'ID do log de auditoria da doação' }])
  static override async execute(ctx: IncomingCommand, args: { auditLogId: number }) {
    const admin = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!admin) return

    await reply(ctx, {
      content: `⚠️ **Confirmar reversão da doação \`#${args.auditLogId}\`?**\n\nIsso vai tentar tirar os itens de volta do destinatário. Se ele não tiver mais algum, cobra dele: 1 giro, depois ${DONATION_REVERT_PENALTY_COINS} moedas, depois outro item do mesmo tier. Quem doou recebe o item original de volta em qualquer um dos casos.`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) return

    const result = await AuditDB.revertDiscotecaDonation(args.auditLogId, admin.id)

    if (!result.ok) {
      if (result.reason === 'nothing_to_penalize') {
        await reply(ctx, `😅 Não deu pra reverter: o destinatário não tem mais nada (item, giro, moedas ou item do mesmo tier) pra cobrir o item \`${result.entryId}\`. Nada foi alterado - a doação continua de pé.`)
      } else {
        await reply(ctx, '🔍 Não encontrei essa doação com esse ID, ou ela já foi revertida antes.')
      }
      return
    }

    const [donor, recipient] = await Promise.all([
      UsersDB.getUserById(result.donorId),
      UsersDB.getUserById(result.recipientId),
    ])

    const countByPenalty = new Map<string, number>()
    for (const outcome of result.unitOutcomes) countByPenalty.set(outcome.penalty, (countByPenalty.get(outcome.penalty) ?? 0) + 1)
    const summary = [...countByPenalty.entries()]
      .map(([penalty, count]) => `${count}x ${PENALTY_LABEL[penalty] ?? penalty}`)
      .join(', ')

    await reply(
      ctx,
      `↩️ Doação \`${args.auditLogId}\` revertida: **${escapeMarkdown(donor?.displayName ?? '?')}** recebeu de volta o que doou para **${escapeMarkdown(recipient?.displayName ?? '?')}**.\n\nCobrado do destinatário: ${summary}.`,
    )
  }
}
