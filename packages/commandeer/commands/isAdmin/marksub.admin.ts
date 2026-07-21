import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'marksub:confirm'

export default class MarkSubcategoryCommand extends Command {
  static override info = {
    name: 'marksub',
    description: 'Adiciona um card a uma subcategoria extra, sem alterar a subcategoria principal (staff)',
    usage: '/marksub <ID do card> <ID ou nome da subcategoria>',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([
    { name: 'card', type: CommandArgumentType.CARD },
    { name: 'subcategory', type: CommandArgumentType.SUBCATEGORY },
  ])
  static override async execute(ctx: IncomingCommand, args: { card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>; subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const { card, subcategory } = args

    await reply(ctx, {
      content: `Deseja colocar **${escapeMarkdown(card.name)}** na subcategoria **${escapeMarkdown(subcategory.name)}**?`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) return

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    await CardsDB.addCardSubcategory(card.id, subcategory.id)
    await AuditDB.log(user.id, 'card.subcategoryAdd', { cardId: card.id, name: card.name, subcategoryId: subcategory.id, subcategoryName: subcategory.name })

    await reply(ctx, `🃏 **${escapeMarkdown(card.name)}** agora também pertence à subcategoria **${escapeMarkdown(subcategory.name)}**.`)
  }
}
