import { Command } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { uploadFromUrl } from '../../services/storage'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class AddImageSubcategoryCommand extends Command {
  static override info = {
    name: 'addimgclc',
    description: 'Define a imagem de capa de uma subcategoria (staff)',
    usage: '/addimgclc <ID ou nome da subcategoria>',
    aliases: ['setimageclc', 'setimgclc']
  }

  static override async execute(ctx: IncomingCommand) {
    const query = ctx.args.join(' ').trim()
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl

    if (!query) {
      await reply(ctx, 'Uso: `/addimgclc <ID ou nome da subcategoria>`, respondendo a uma foto (ou enviando junto com a legenda).')
      return
    }

    const asId = parseInt(query, 10)
    let subcategory = !isNaN(asId) ? await CardsDB.getSubcategory(asId) : undefined
    if (!subcategory && isNaN(asId)) {
      const results = await CardsDB.searchSubcategoriesByName(query, 1)
      if (results[0]) subcategory = await CardsDB.getSubcategory(results[0].id)
    }
    if (!subcategory) {
      await reply(ctx, 'Subcategoria não encontrada.')
      return
    }

    if (!photoUrl) {
      await reply(ctx, 'Não encontrei nenhuma foto na mensagem ou na resposta.')
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const cdnUrl = await uploadFromUrl(photoUrl, 'subcategories')
    await CardsDB.updateSubcategory(subcategory.id, { imageUrl: cdnUrl })

    await AuditDB.log(user.id, 'subcategory.imageUpdate', { subcategoryId: subcategory.id, name: subcategory.name })

    await reply(ctx, {
      content: `Imagem da subcategoria **${escapeMarkdown(subcategory.name)}** atualizada.`,
      photoUrl: cdnUrl,
    })
  }
}
