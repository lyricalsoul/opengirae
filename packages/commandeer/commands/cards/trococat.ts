import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

type Subcategory = NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>>

export default class TrocoCatCommand extends Command {
  static override info = {
    name: 'trococat',
    description: 'Marca todos os cards que você tem de uma coleção como trocáveis',
    usage: '/trococat <id ou nome da coleção>',
    aliases: ['trococol'],
  }

  @CommandArgument([{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY, description: 'ID ou nome da coleção' }])
  static override async execute(ctx: IncomingCommand, args: { subcategory: Subcategory }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const cardIds = await CardsDB.setSubcategoryCardsTradable(user.id, args.subcategory.id, true)
    if (cardIds.length === 0) {
      await reply(ctx, `😂 Troca o que? Você não tem nenhum card de **${escapeMarkdown(args.subcategory.name)}**.`)
      return
    }

    const cards = await CardsDB.getCardsByIds(cardIds)
    const list = cards.map(c => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**`).join('\n')
    await reply(ctx, `🔄 **Marcados como trocáveis (${escapeMarkdown(args.subcategory.name)}):**\n${list}`)
  }
}
