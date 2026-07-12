import { Command } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply } from '@girae/common/dbos/messaging'
import { uploadCardImage } from '../../services/cardImage'
import { uploadFromUrl } from '../../services/storage'
import { inferCardData } from '../../services/cardInference'
import { runCardWizard } from '../../services/cardWizard'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class AddCardCommand extends Command {
  static override info = {
    name: 'addcard',
    description: 'Adiciona uma nova carta a partir de uma mensagem respondida (staff)',
    usage: '/addcard <descrição>',
    useWorkflow: true
  }

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    const sourceText = ctx.args.join(' ').trim() || ctx.message.replyTo?.content
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl

    const isAnimated = ctx.message.photoUrl ? ctx.message.isAnimatedPhoto : ctx.message.replyTo?.isAnimatedPhoto

    if (!sourceText) {
      await reply(ctx, 'Descreva o card nos argumentos (ex: `/addcard Winter da aespa, era Armageddon`) ou responda a uma mensagem com essa descrição.')
      return
    }
    if (!photoUrl) {
      await reply(ctx, 'Não encontrei nenhuma foto na mensagem ou na resposta.')
      return
    }

    const categories = await CardsDB.getCategories()
    const rarities = await CardsDB.getRarities()
    if (rarities.length === 0) {
      await reply(ctx, 'Não há raridades cadastradas ainda.')
      return
    }

    const inferred = await inferCardData(sourceText, categories.map(c => c.name), rarities.map(r => r.name))
    if (!inferred) {
      await reply(ctx, 'Não foi possível inferir os dados do card. Tente novamente.')
      return
    }
    if (inferred.error) {
      await reply(ctx, `⚠️ ${inferred.error}`)
      return
    }

    const cdnUrl = isAnimated ? await uploadFromUrl(photoUrl, 'cards') : await uploadCardImage(photoUrl)

    const replyCtx = ctx.message.replyTo
      ? { ...ctx, message: { ...ctx.message, id: ctx.message.replyTo.id } }
      : ctx

    await runCardWizard(replyCtx, {
      cardData: {
        name: inferred.name,
        category: inferred.category,
        subcategory: inferred.subcategory,
        rarity: inferred.rarity,
        tags: (inferred.tags ?? []).filter(Boolean),
      },
      photoUrl: cdnUrl,
      mode: 'create',
    })
  }
}
