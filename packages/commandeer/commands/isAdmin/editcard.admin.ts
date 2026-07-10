import { Command } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply } from '@girae/common/dbos/messaging'
import { uploadCardImage } from '../../services/cardImage'
import { uploadFromUrl } from '../../services/storage'
import { runCardWizard } from '../../services/cardWizard'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class EditCardCommand extends Command {
  static override info = {
    name: 'editcard',
    description: 'Edita uma carta existente (staff)',
    useWorkflow: true
  }

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    const cardId = parseInt(ctx.args[0] ?? '', 10)
    if (isNaN(cardId)) {
      await reply(ctx, 'Uso: `/editcard <ID do card>`')
      return
    }

    const card = await CardsDB.getCardForEdit(cardId)
    if (!card) {
      await reply(ctx, 'Card não encontrado.')
      return
    }

    const tags = await CardsDB.getSecondarySubcategoryNames(cardId)

    const newPhotoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl
    const isAnimated = ctx.message.photoUrl ? ctx.message.isAnimatedPhoto : ctx.message.replyTo?.isAnimatedPhoto

    const photoUrl = newPhotoUrl
      ? (isAnimated ? await uploadFromUrl(newPhotoUrl, 'cards') : await uploadCardImage(newPhotoUrl))
      : (card.imageUrl ?? '')

    await runCardWizard(ctx, {
      cardData: {
        name: card.name,
        category: card.categoryName ?? 'Geral',
        subcategory: card.subcategoryName ?? 'Geral',
        rarity: card.rarityName,
        tags,
      },
      photoUrl,
      mode: 'edit',
      existingCardId: cardId,
    })
  }
}
