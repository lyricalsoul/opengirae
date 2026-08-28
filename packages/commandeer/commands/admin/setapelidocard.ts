import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class SetApelidoCardCommand extends Command {
  static override info = {
    guards: ['isAdmin'],
    name: 'setapelidocard',
    description: 'Adiciona um apelido a um card (staff)',
    usage: '/setapelidocard <ID ou nome do card> <apelido>',
    aliases: ['addapelidocard'],
  }

  @CommandArgument([
    { name: 'card', type: CommandArgumentType.CARD },
    { name: 'alias', type: CommandArgumentType.STRING },
  ])
  static override async execute(ctx: IncomingCommand, args: { card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>; alias: string }) {
    const { card, alias } = args

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    await CardsDB.addCardAlias(card.id, alias)
    await AuditDB.log(user.id, 'card.aliasAdd', { cardId: card.id, cardName: card.name, alias })

    await reply(ctx, `🏷 **${escapeMarkdown(alias.trim().toLowerCase())}** agora resolve para **${escapeMarkdown(card.name)}**.`)
  }
}
