import { Command } from '@girae/common/commands'
import { VanitiesDB } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { uploadFromUrl } from '../../services/storage'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class AddImageBackgroundCommand extends Command {
  static override info = {
    name: 'addimgbg',
    description: 'Define a imagem de um papel de parede de perfil (staff)',
    usage: '/addimgbg <ID do papel de parede>',
    aliases: ['setimagebg', 'setimgbg']
  }

  static override async execute(ctx: IncomingCommand) {
    const query = ctx.args[0]
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl

    if (!query) {
      await reply(ctx, 'Uso: `/addimgbg <ID do papel de parede>`, respondendo a uma foto (ou enviando junto com a legenda).')
      return
    }

    const itemId = parseInt(query, 10)
    const item = !isNaN(itemId) ? await VanitiesDB.getStoreItemById(itemId) : undefined
    if (!item || item.type !== 'background') {
      await reply(ctx, 'Papel de parede não encontrado.')
      return
    }

    if (!photoUrl) {
      await reply(ctx, 'Não encontrei nenhuma foto na mensagem ou na resposta.')
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const cdnUrl = await uploadFromUrl(photoUrl, 'backgrounds')
    await VanitiesDB.updateStoreItem(item.id, { itemURL: cdnUrl })

    await AuditDB.log(user.id, 'vanity.background.imageUpdate', { itemId: item.id, title: item.title })

    await reply(ctx, {
      content: `🛍 Imagem do papel de parede **${escapeMarkdown(item.title)}** atualizada.`,
      photoUrl: cdnUrl,
    })
  }
}
