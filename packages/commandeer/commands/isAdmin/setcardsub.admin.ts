import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class SetCardSubcategoryCommand extends Command {
  static override info = {
    name: 'setcardsub',
    description: 'Muda a subcategoria principal de um card (staff)',
    usage: '/setcardsub <ID do card> <ID ou nome da subcategoria>',
    aliases: ['setcardsubcat']
  }

  @CommandArgument([
    { name: 'card', type: CommandArgumentType.CARD },
    { name: 'subcategory', type: CommandArgumentType.SUBCATEGORY },
  ])
  static override async execute(ctx: IncomingCommand, args: { card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>; subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const { card, subcategory } = args

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    await CardsDB.setCardMainSubcategory(card.id, subcategory.id)
    await AuditDB.log(user.id, 'card.subcategoryUpdate', { cardId: card.id, name: card.name, subcategoryId: subcategory.id, subcategoryName: subcategory.name })

    await reply(ctx, `🃏 Subcategoria de **${escapeMarkdown(card.name)}** alterada para **${escapeMarkdown(subcategory.name)}**.`)
  }
}
