import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import type { CardsDB } from '@girae/database/cards'
import { modifyTradeOffer } from './trade.cards'
import type { IncomingCommand } from '@girae/common/commands/types'

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

export default class AddCommand extends Command {
  static override info = {
    name: 'add',
    description: 'Adiciona rapidamente uma carta à troca em andamento',
    usage: '/add <nome ou ID do personagem>',
    aliases: ['adicionar'],
  }

  @CommandArgument([{ name: 'card', type: CommandArgumentType.CARD, description: 'ID ou nome do personagem' }])
  static override async execute(ctx: IncomingCommand, args: { card: CardDetails }) {
    const message = await modifyTradeOffer(ctx.message.author.id, ctx.message.platform as 'telegram' | 'discord', args.card.id, 'add')
    await reply(ctx, { content: message, photoUrl: args.card.imageUrl ?? undefined })
  }
}
