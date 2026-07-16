import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'delsubcategory:confirm'

export default class DeleteSubcategoryCommand extends Command {
  static override info = {
    name: 'delsubcategory',
    description: 'Deleta uma subcategoria vazia (staff)',
    usage: '/delsubcategory <ID ou nome da subcategoria>',
    aliases: ['delsub'],
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY }])
  static override async execute(ctx: IncomingCommand, args: { subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const { subcategory } = args

    await reply(ctx, {
      content: `🗑️ Deletar a subcategoria **${escapeMarkdown(subcategory.name)}** (\`${subcategory.id}\`)? Essa ação não pode ser desfeita.`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) return

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const result = await CardsDB.deleteSubcategory(subcategory.id)
    if (!result.ok) {
      await reply(ctx, `Não foi possível deletar **${escapeMarkdown(subcategory.name)}**, pois ela ainda tem cards.`)
      return
    }

    await AuditDB.log(user.id, 'subcategory.delete', { subcategoryId: subcategory.id, name: subcategory.name })
    await reply(ctx, `🗑️ **${escapeMarkdown(subcategory.name)}** foi deletada.`)
  }
}
