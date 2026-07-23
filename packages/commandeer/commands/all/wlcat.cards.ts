import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

type Subcategory = NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>>

export default class WishlistCategoryCommand extends Command {
  static override info = {
    name: 'wlcat',
    description: 'Adiciona todos os cards de uma subcategoria à sua lista de desejos',
    usage: '/wlcat <id ou nome da subcategoria>',
    aliases: ['wlcol', 'wishcol'],
  }

  @CommandArgument([{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY, description: 'ID ou nome da subcategoria' }])
  static override async execute(ctx: IncomingCommand, args: { subcategory: Subcategory }) {
    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!viewer) return

    const cardsInSubcategory = await CardsDB.getCardsInSubcategoryForUser(args.subcategory.id, viewer.id)
    if (cardsInSubcategory.length === 0) {
      await reply(ctx, `**${escapeMarkdown(args.subcategory.name)}** não tem nenhum card.`)
      return
    }

    const added: string[] = []
    for (const card of cardsInSubcategory) {
      const alreadyOnList = await CardsDB.isOnWishlist(viewer.id, card.id)
      if (alreadyOnList) continue
      await CardsDB.addToWishlist(viewer.id, card.id)
      added.push(`${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**`)
    }

    if (added.length === 0) {
      await reply(ctx, `Todos os cards de **${escapeMarkdown(args.subcategory.name)}** já estão na sua lista de desejos.`)
      return
    }

    await reply(ctx, `💝 **Adicionados à lista de desejos de ${escapeMarkdown(args.subcategory.name)}:**\n${added.join('\n')}`)
  }
}
