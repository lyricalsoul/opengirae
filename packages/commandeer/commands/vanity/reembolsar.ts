import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { VanitiesDB, REFUND_WINDOW_MS } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'reembolsar:confirm'
const TYPE_LABEL = { background: 'papel de parede', sticker: 'sticker' } as const

function minutesLeft(boughtAt: Date): number {
  const deadline = boughtAt.getTime() + REFUND_WINDOW_MS
  return Math.max(0, Math.ceil((deadline - Date.now()) / 60_000))
}

export default class ReembolsarCommand extends Command {
  static override info = {
    name: 'reembolsar',
    description: 'Reembolsa um item da loja comprado na última 1h',
    usage: '/reembolsar [ID do item]',
    aliases: ['refund', 'estornar'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'itemId', type: CommandArgumentType.NUMBER, nullable: true, description: 'ID do item comprado' }])
  static override async execute(ctx: IncomingCommand, args: { itemId?: number }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const refundable = await VanitiesDB.getRefundableItems(user.id)

    if (args.itemId === undefined) {
      if (refundable.length === 0) {
        await reply(ctx, 'Você não tem nenhuma compra elegível pra reembolso agora. Só dá pra reembolsar até 1h depois da compra. 😅')
        return
      }

      const list = refundable
        .map(i => `🛍 \`${i.id}\`. **${escapeMarkdown(i.title)}** (${TYPE_LABEL[i.type as 'background' | 'sticker']}) — 💸 ${i.pricePaid} moedas, expira em \`${minutesLeft(i.boughtAt)}min\``)
        .join('\n')
      await reply(ctx, `↩️ Suas compras elegíveis pra reembolso:\n\n${list}\n\nUse \`/reembolsar ID\` pra reembolsar uma delas.`)
      return
    }

    const target = refundable.find(i => i.id === args.itemId)
    if (!target) {
      await reply(ctx, 'Não encontrei essa compra, ou o prazo de 1h pra reembolso dela já passou. 😔')
      return
    }

    await reply(ctx, {
      content: `↩️ Reembolsar **${escapeMarkdown(target.title)}** (${TYPE_LABEL[target.type as 'background' | 'sticker']})?\n💸 Você recebe de volta ${target.pricePaid} moedas, e o item é removido do seu inventário (desequipando-o, se estiver equipado).`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true, color: 'success' }, { title: '❌ Cancelar', data: false, color: 'danger' }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) return

    const result = await VanitiesDB.refundItem(user.id, target.id)
    if (!result.ok) {
      await reply(ctx, 'Vish, o prazo de 1h pra reembolsar essa compra acabou de expirar. Nada foi alterado.')
      return
    }

    await AuditDB.log(user.id, 'vanity.refund', { itemId: target.id, title: result.title, refundedPrice: result.refundedPrice })

    await reply(ctx, `↩️ **${escapeMarkdown(result.title)}** reembolsado!\n💸 +${result.refundedPrice} moedas`)
  }
}
