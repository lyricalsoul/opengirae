import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { CardsDB, DONATION_REVERT_PENALTY_COINS } from '@girae/database/cards'
import { buildCtx } from '../../services/syntheticCtx'
import type { IncomingCommand, Platform } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'doacaocancelar:confirm'

// mirrors AuditDB.revertDonation's DonationRevertPenalty['penalty'] values.
const PENALTY_LABEL: Record<string, string> = {
  card_returned: 'a mesma carta',
  draw_taken: '1 giro',
  coins_taken: `${DONATION_REVERT_PENALTY_COINS} moedas`,
  same_tier_card_taken: 'outra carta do mesmo tier',
}

export default class DoacaoCancelarCommand extends Command {
  static override info = {
    guards: ['isAdmin'],
    name: 'doacaocancelar',
    description: 'Reverte uma doação (/doar ou /doarclc) - o ID vem do histórico de doações no site de staff (staff)',
    usage: '/doacaocancelar <ID da doação>',
    aliases: ['canceladoacao'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'auditLogId', type: CommandArgumentType.NUMBER, description: 'ID do log de auditoria da doação' }])
  static override async execute(ctx: IncomingCommand, args: { auditLogId: number }) {
    const admin = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!admin) return

    await reply(ctx, {
      content: `⚠️ **Confirmar reversão da doação \`#${args.auditLogId}\`?**\n\nIsso vai tentar tirar as cartas de volta do destinatário. Se ele não tiver mais alguma, cobra dele: 1 giro, depois ${DONATION_REVERT_PENALTY_COINS} moedas, depois outra carta do mesmo tier. Quem doou recebe a carta original de volta em qualquer um dos casos.`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) return

    const result = await AuditDB.revertDonation(args.auditLogId, admin.id)

    if (!result.ok) {
      if (result.reason === 'nothing_to_penalize') {
        await reply(ctx, `😅 Não deu pra reverter: o destinatário não tem mais nada (carta, giro, moedas ou carta do mesmo tier) pra cobrir a carta \`${result.cardId}\`. Nada foi alterado - a doação continua de pé.`)
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

    // the donor always gets the exact card(s) they donated back, regardless of the recipient's penalty.
    const returnedQtyByCardId = new Map<number, number>()
    for (const outcome of result.unitOutcomes) {
      returnedQtyByCardId.set(outcome.donatedCardId, (returnedQtyByCardId.get(outcome.donatedCardId) ?? 0) + 1)
    }
    const returnedCardsById = new Map((await CardsDB.getCardsByIds([...returnedQtyByCardId.keys()])).map(c => [c.id, c]))
    const returnedList = [...returnedQtyByCardId.entries()]
      .map(([cardId, qty]) => {
        const c = returnedCardsById.get(cardId)
        return c ? `${c.rarityEmoji}. **${escapeMarkdown(c.name)}** (${qty})` : `\`${cardId}\` (${qty})`
      })
      .join(', ')

    if (donor) {
      for (const platform of ['telegram', 'discord'] as Platform[]) {
        const donorPlatformId = await UsersDB.getPlatformIdForUser(donor.id, platform)
        if (!donorPlatformId) continue
        await reply(buildCtx(platform, donorPlatformId, donor.displayName, donorPlatformId), `Um administrador reverteu a sua doação, você recebeu de volta ${returnedList}.`)
        break
      }
    }

    await reply(
      ctx,
      `↩️ Doação \`${args.auditLogId}\` revertida: **${escapeMarkdown(donor?.displayName ?? '?')}** recebeu de volta o que doou para **${escapeMarkdown(recipient?.displayName ?? '?')}**.\n\nCobrado do destinatário: ${summary}.`,
    )
  }
}
