import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { uploadFromUrl } from '@girae/common/utilities/storage'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class AddImageSubcategoryCommand extends Command {
  static override info = {
    name: 'addimgclc',
    description: 'Define a imagem de capa de uma subcategoria (staff)',
    usage: '/addimgclc <ID ou nome da subcategoria>',
    aliases: ['setimageclc', 'setimgclc']
  }

  @CommandArgument([{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY }])
  static override async execute(ctx: IncomingCommand, args: { subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const subcategory = args.subcategory
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl

    if (!photoUrl) {
      await reply(ctx, 'Não encontrei nenhuma foto na mensagem ou na resposta.')
      return
    }

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
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
