import { Command } from '@girae/common/commands'
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
    aliases: ['addsub', 'createsub']
  }

  static override async execute(ctx: IncomingCommand) {
    const [categoryIdRaw, ...nameParts] = ctx.args
    const name = nameParts.join(' ').trim()
    const categoryId = parseInt(categoryIdRaw ?? '', 10)

    if (isNaN(categoryId) || !name) {
      await reply(ctx, 'Uso: `/addsubcategory <id da categoria> <nome>` (o nome pode ter mais de uma palavra).')
      return
    }

    const category = await CardsDB.getCategory(categoryId)
    if (!category) {
      const categories = await CardsDB.getCategories()
      const list = categories.map(c => `${c.emoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**`).join('\n')
      await reply(ctx, `Categoria não encontrada. As seguintes categorias estão disponíveis:\n\n${list}`)
      return
    }

    const existing = await CardsDB.getSubcategoryByNameAndCategory(name, categoryId)
    if (existing) {
      await reply(ctx, 'Subcategoria já existe.')
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const subcategory = await CardsDB.createSubcategory(name, categoryId)
    if (!subcategory) return

    await AuditDB.log(user.id, 'subcategory.create', { subcategoryId: subcategory.id, name, categoryEmoji: category.emoji })

    await reply(ctx, `Subcategoria criada com sucesso.\n\n${category.emoji} \`${subcategory.id}\`. **${escapeMarkdown(name)}**`)
  }
}
