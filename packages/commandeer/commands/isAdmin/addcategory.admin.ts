import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class AddCategoryCommand extends Command {
  static override info = {
    name: 'addcategory',
    description: 'Adiciona uma nova categoria (staff)',
    usage: '/addcategory <emoji> <nome>',
    aliases: ['addcategoria']
  }

  @CommandArgument([
    { name: 'emoji', type: CommandArgumentType.STRING },
    { name: 'name', type: CommandArgumentType.STRING },
  ])
  static override async execute(ctx: IncomingCommand, args: { emoji: string; name: string }) {
    const existing = await CardsDB.getCategoryByName(args.name)
    if (existing) {
      await reply(ctx, `Já existe uma categoria chamada **${escapeMarkdown(args.name)}**.`)
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const category = await CardsDB.createCategory(args.name, args.emoji)
    if (!category) return

    await AuditDB.log(user.id, 'category.create', { categoryId: category.id, name: args.name, emoji: args.emoji })

    await reply(ctx, `${args.emoji} Categoria criada: \`${category.id}\`. **${escapeMarkdown(args.name)}**`)
  }
}
