import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import type { CardsDB } from '@girae/database/cards'
import { modifyTradeOffer } from './trade.cards'
import type { IncomingCommand } from '@girae/common/commands/types'

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

export default class RemoveCommand extends Command {
  static override info = {
    name: 'remove',
    description: 'Remove rapidamente uma carta da troca em andamento',
    usage: '/remove <nome ou ID do personagem>',
    aliases: ['rem'],
  }

  @CommandArgument([{ name: 'card', type: CommandArgumentType.CARD }])
  static override async execute(ctx: IncomingCommand, args: { card: CardDetails }) {
    const message = await modifyTradeOffer(ctx.message.author.id, args.card.id, 'remove')
    await reply(ctx, { content: message, photoUrl: args.card.imageUrl ?? undefined })
  }
}
