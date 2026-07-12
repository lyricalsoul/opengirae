import { Command } from '@girae/common/commands'
import { VanitiesDB } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { uploadFromUrl } from '../../services/storage'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class AddImageStickerCommand extends Command {
  static override info = {
    name: 'addimgsticker',
    description: 'Define a imagem de um sticker de perfil (staff)',
    usage: '/addimgsticker <ID do sticker>',
    aliases: ['setimagesticker', 'setimgsticker']
  }

  static override async execute(ctx: IncomingCommand) {
    const query = ctx.args[0]
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl

    if (!query) {
      await reply(ctx, 'Uso: `/addimgsticker <ID do sticker>`, respondendo a uma foto (ou enviando junto com a legenda).')
      return
    }

    const itemId = parseInt(query, 10)
    const item = !isNaN(itemId) ? await VanitiesDB.getStoreItemById(itemId) : undefined
    if (!item || item.type !== 'sticker') {
      await reply(ctx, 'Sticker não encontrado.')
      return
    }

    if (!photoUrl) {
      await reply(ctx, 'Não encontrei nenhuma foto na mensagem ou na resposta.')
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const cdnUrl = await uploadFromUrl(photoUrl, 'stickers')
    await VanitiesDB.updateStoreItem(item.id, { itemURL: cdnUrl })

    await AuditDB.log(user.id, 'vanity.sticker.imageUpdate', { itemId: item.id, title: item.title })

    await reply(ctx, {
      content: `🛍 Imagem do sticker **${escapeMarkdown(item.title)}** atualizada.`,
      photoUrl: cdnUrl,
    })
  }
}
