import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

export default class FavCardCommand extends Command {
  static override info = {
    name: 'favcard',
    description: 'Define sua carta favorita',
    usage: '/favcard <nome ou ID do personagem>',
    aliases: ['fav', 'favorito', 'favorite'],
  }

  @CommandArgument([{ name: 'card', type: CommandArgumentType.CARD, description: 'ID ou nome do personagem' }])
  static override async execute(ctx: IncomingCommand, args: { card: CardDetails }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    if (!(await CardsDB.hasUserCard(user.id, args.card.id))) {
      await reply(ctx, 'Oops... parece que você ainda não tem esse personagem. 😅\nEncontre-o usando `/girar` para favoritá-lo.')
      return
    }

    await UsersDB.setFavoriteCard(user.id, args.card.id)

    await reply(ctx, {
      content: `🌟 **${escapeMarkdown(args.card.name)}** é agora o seu personagem favorito!`,
      photoUrl: args.card.imageUrl ?? undefined,
    })
  }
}
