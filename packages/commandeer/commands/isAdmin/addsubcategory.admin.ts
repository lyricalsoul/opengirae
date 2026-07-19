import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class AddSubcategoryCommand extends Command {
  static override info = {
    name: 'addsubcategory',
    description: 'Adiciona uma nova subcategoria a uma categoria (staff)',
    usage: '/addsubcategory <ID da categoria> <nome>',
    aliases: ['addsub', 'createsub']
  }

  @CommandArgument([
    { name: 'category', type: CommandArgumentType.CATEGORY },
    { name: 'name', type: CommandArgumentType.STRING },
  ])
  static override async execute(ctx: IncomingCommand, args: { category: NonNullable<Awaited<ReturnType<typeof CardsDB.getCategory>>>; name: string }) {
    const { category, name } = args
    const categoryId = category.id

    const existing = await CardsDB.getSubcategoryByNameAndCategory(name, categoryId)
    if (existing) {
      await reply(ctx, 'Subcategoria já existe.')
      return
    }

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const subcategory = await CardsDB.createSubcategory(name, categoryId)
    if (!subcategory) return

    await AuditDB.log(user.id, 'subcategory.create', { subcategoryId: subcategory.id, name, categoryEmoji: category.emoji })

    await reply(ctx, `Subcategoria criada com sucesso.\n\n${category.emoji} \`${subcategory.id}\`. **${escapeMarkdown(name)}**`)
  }
}
