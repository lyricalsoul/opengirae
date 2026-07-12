import { Command } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { uploadFromUrl } from '../../services/storage'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class AddImageCategoryCommand extends Command {
  static override info = {
    name: 'addimgcat',
    description: 'Define a imagem de capa de uma categoria (staff)',
    usage: '/addimgcat <ID ou nome da categoria>',
    aliases: ['setimagecat', 'setimgcat']
  }

  static override async execute(ctx: IncomingCommand) {
    const query = ctx.args.join(' ').trim()
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl

    if (!query) {
      await reply(ctx, 'Uso: `/addimgcat <ID ou nome da categoria>`, respondendo a uma foto (ou enviando junto com a legenda).')
      return
    }

    const asId = parseInt(query, 10)
    const category = !isNaN(asId) ? await CardsDB.getCategory(asId) : await CardsDB.getCategoryByName(query)
    if (!category) {
      await reply(ctx, 'Categoria não encontrada.')
      return
    }

    if (!photoUrl) {
      await reply(ctx, 'Não encontrei nenhuma foto na mensagem ou na resposta.')
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const cdnUrl = await uploadFromUrl(photoUrl, 'categories')
    await CardsDB.updateCategory(category.id, { drawImageUrl: cdnUrl })

    await AuditDB.log(user.id, 'category.imageUpdate', { categoryId: category.id, name: category.name })

    await reply(ctx, {
      content: `${category.emoji} Imagem da categoria **${escapeMarkdown(category.name)}** atualizada.`,
      photoUrl: cdnUrl,
    })
  }
}
