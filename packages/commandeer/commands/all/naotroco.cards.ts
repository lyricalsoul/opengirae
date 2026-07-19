import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

type CardWithDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

export default class NaoTrocoCommand extends Command {
  static override info = {
    name: 'naotroco',
    description: 'Marca um card como não trocável',
    usage: '/naotroco id ou nome do card',
    aliases: ['nl', 'nt', 'dt', 'donttrade'],
  }

  @CommandArgument([{
    name: 'card',
    type: CommandArgumentType.CARD,
    guard: async (card: CardWithDetails, ctx: IncomingCommand) => {
      const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
      if (!user) return false
      return (await CardsDB.hasUserCard(user.id, card.id)) || '😂 Não troca o que? Você não tem esse card.'
    },
  }])
  static override async execute(ctx: IncomingCommand, args: { card: CardWithDetails }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    await CardsDB.setCardTradable(user.id, args.card.id, false)
    await reply(ctx, `🔒 **${escapeMarkdown(args.card.name)}** agora está marcado como não trocável.`)
  }
}
