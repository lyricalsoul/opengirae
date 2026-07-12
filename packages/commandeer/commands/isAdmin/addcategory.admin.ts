import { Command } from '@girae/common/commands'
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

  static override async execute(ctx: IncomingCommand) {
    const [emoji, ...nameParts] = ctx.args
    const name = nameParts.join(' ').trim()

    if (!emoji || !name) {
      await reply(ctx, 'Uso: `/addcategory <emoji> <nome>` (o nome pode ter mais de uma palavra).')
      return
    }

    const existing = await CardsDB.getCategoryByName(name)
    if (existing) {
      await reply(ctx, `Já existe uma categoria chamada **${escapeMarkdown(name)}**.`)
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const category = await CardsDB.createCategory(name, emoji)
    if (!category) return

    await AuditDB.log(user.id, 'category.create', { categoryId: category.id, name, emoji })

    await reply(ctx, `${emoji} Categoria criada: \`${category.id}\`. **${escapeMarkdown(name)}**`)
  }
}
