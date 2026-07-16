import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'delcard:confirm'

export default class DeleteCardCommand extends Command {
  static override info = {
    name: 'delcard',
    description: 'Deleta um card (staff)',
    usage: '/delcard <ID do card>',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'card', type: CommandArgumentType.CARD }])
  static override async execute(ctx: IncomingCommand, args: { card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>> }) {
    const card = args.card

    await reply(ctx, {
      content: `🗑️ Deletar **${escapeMarkdown(card.name)}** (\`${card.id}\`)? Essa ação não pode ser desfeita.`,
      photoUrl: card.imageUrl ?? undefined,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (!confirmSelection?.value) {
      if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const deleted = await CardsDB.deleteCard(card.id).then(() => true).catch((e) => {
      if (e?.code === '23503') return false // someone already owns/drew/favorited this card
      throw e
    })

    if (confirmSelection.messageId) await deleteMsg(ctx, confirmSelection.messageId)

    if (!deleted) {
      await reply(ctx, `Não foi possível deletar **${escapeMarkdown(card.name)}**: já existe alguém com esse card na coleção.`)
      return
    }

    await AuditDB.log(user.id, 'card.delete', { cardId: card.id, name: card.name })
    await reply(ctx, `🗑️ **${escapeMarkdown(card.name)}** foi deletado.`)
  }
}
