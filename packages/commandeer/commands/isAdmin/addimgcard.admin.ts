import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { uploadCardImage } from '../../services/cards/cardImage'
import { uploadFromUrl } from '@girae/common/utilities/storage'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class AddImageCardCommand extends Command {
  static override info = {
    name: 'addimgcard',
    description: 'Define a imagem de um card (staff)',
    usage: '/addimgcard <ID do card>',
    aliases: ['setimage', 'setimg']
  }

  @CommandArgument([{ name: 'card', type: CommandArgumentType.CARD }])
  static override async execute(ctx: IncomingCommand, args: { card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>> }) {
    const card = args.card
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl
    const isAnimated = ctx.message.photoUrl ? ctx.message.isAnimatedPhoto : ctx.message.replyTo?.isAnimatedPhoto

    if (!photoUrl) {
      await reply(ctx, 'Não encontrei nenhuma foto na mensagem ou na resposta.')
      return
    }

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const cdnUrl = isAnimated ? await uploadFromUrl(photoUrl, 'cards') : await uploadCardImage(photoUrl)
    await CardsDB.updateCard(card.id, { imageUrl: cdnUrl })

    await AuditDB.log(user.id, 'card.imageUpdate', { cardId: card.id, name: card.name })

    await reply(ctx, {
      content: `🃏 Imagem do card **${escapeMarkdown(card.name)}** atualizada.`,
      photoUrl: cdnUrl,
    })
  }
}
