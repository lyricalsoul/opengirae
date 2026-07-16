import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
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

  @CommandArgument([{ name: 'item', type: CommandArgumentType.VANITY_ITEM, vanityType: 'sticker' }])
  static override async execute(ctx: IncomingCommand, args: { item: NonNullable<Awaited<ReturnType<typeof VanitiesDB.getStoreItemById>>> }) {
    const item = args.item
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl

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
