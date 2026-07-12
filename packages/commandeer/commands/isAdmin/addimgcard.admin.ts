import { Command } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { uploadCardImage } from '../../services/cardImage'
import { uploadFromUrl } from '../../services/storage'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class AddImageCardCommand extends Command {
  static override info = {
    name: 'addimgcard',
    description: 'Define a imagem de um card (staff)',
    usage: '/addimgcard <ID do card>',
    aliases: ['setimage', 'setimg']
  }

  static override async execute(ctx: IncomingCommand) {
    const query = ctx.args[0]
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl
    const isAnimated = ctx.message.photoUrl ? ctx.message.isAnimatedPhoto : ctx.message.replyTo?.isAnimatedPhoto

    if (!query) {
      await reply(ctx, 'Uso: `/addimgcard <ID do card>`, respondendo a uma foto (ou enviando junto com a legenda).')
      return
    }

    const cardId = parseInt(query, 10)
    const card = !isNaN(cardId) ? await CardsDB.getCard(cardId) : undefined
    if (!card) {
      await reply(ctx, 'Card não encontrado.')
      return
    }

    if (!photoUrl) {
      await reply(ctx, 'Não encontrei nenhuma foto na mensagem ou na resposta.')
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
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
