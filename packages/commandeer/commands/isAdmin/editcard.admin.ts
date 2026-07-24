import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply } from '@girae/common/dbos/messaging'
import { uploadCardImage } from '../../services/cards/cardImage'
import { uploadFromUrl } from '@girae/common/utilities/storage'
import { runCardWizard } from '../../services/cards/cardWizard'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class EditCardCommand extends Command {
  static override info = {
    name: 'editcard',
    description: 'Edita uma carta existente (staff)',
    usage: '/editcard <ID do card>',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'card', type: CommandArgumentType.CARD }])
  static override async execute(ctx: IncomingCommand, args: { card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>> }) {
    const card = await CardsDB.getCardForEdit(args.card.id)
    if (!card) {
      await reply(ctx, 'Card não encontrado.')
      return
    }

    const tags = await CardsDB.getSecondarySubcategoryNames(args.card.id)

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
      existingCardId: args.card.id,
    })
  }
}
