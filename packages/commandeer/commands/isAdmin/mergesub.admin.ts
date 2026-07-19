import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'mergesub:confirm'

export default class MergeSubcategoryCommand extends Command {
  static override info = {
    name: 'mergesub',
    description: 'Move todos os cards de uma subcategoria para outra e deleta a de origem (staff)',
    usage: '/mergesub <id de origem> <id de destino>',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([
    { name: 'from', type: CommandArgumentType.SUBCATEGORY },
    { name: 'to', type: CommandArgumentType.SUBCATEGORY },
  ])
  static override async execute(ctx: IncomingCommand, args: { from: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>>; to: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const { from, to } = args
    const fromId = from.id
    const toId = to.id

    if (fromId === toId) {
      await reply(ctx, 'Uso: `/mergesub <id de origem> <id de destino>` (precisam ser diferentes)')
      return
    }

    const count = await CardsDB.getSubcategoryCardCount(fromId)

    await reply(ctx, {
      content: `🔀 Mover **${escapeMarkdown(from.name)}** (\`${from.id}\`) para **${escapeMarkdown(to.name)}** (\`${to.id}\`)?\n\n${count} card(s) serão movidos. **${escapeMarkdown(from.name)}** será deletada. Essa ação não pode ser desfeita.`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) return

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const moved = await CardsDB.mergeSubcategory(fromId, toId)
    await AuditDB.log(user.id, 'subcategory.merge', { fromId, fromName: from.name, toId, toName: to.name, cardsMoved: moved })
    await reply(ctx, `🔀 **${escapeMarkdown(from.name)}** foi mesclada em **${escapeMarkdown(to.name)}** (${moved} card(s) movidos).`)
  }
}
