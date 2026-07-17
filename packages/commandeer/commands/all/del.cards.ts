import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { CARD_DISCARD_REWARDS } from '@girae/database/constants'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'del:confirm'

export default class DelCommand extends Command {
  static override info = {
    name: 'del',
    description: 'Descarta um ou mais cards em troca de moedas',
    usage: '/del <ID> [ID2] [ID3] ...',
    aliases: ['deletar'],
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'ids', type: CommandArgumentType.STRING }])
  static override async execute(ctx: IncomingCommand, args: { ids: string }) {
    const tokens = args.ids.split(/\s+/).filter(Boolean)

    const cardIds: number[] = []
    for (const token of tokens) {
      if (!/^\d+$/.test(token)) {
        await reply(ctx, `\`${escapeMarkdown(token)}\` não é um ID de card válido. Nenhum card foi removido.`)
        return
      }
      cardIds.push(parseInt(token, 10))
    }
    const uniqueIds = [...new Set(cardIds)]

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const cards = await CardsDB.getCardsByIds(uniqueIds)
    const cardsById = new Map(cards.map(c => [c.id, c]))

    const missing = uniqueIds.filter(id => !cardsById.has(id))
    if (missing.length > 0) {
      await reply(ctx, `Você não possui o card \`${missing[0]}\`. Nenhum card foi removido.`)
      return
    }

    const estimatedTotal = uniqueIds.reduce((sum, id) => sum + (CARD_DISCARD_REWARDS[cardsById.get(id)!.rarityName] ?? 0), 0)
    const list = uniqueIds.map(id => {
      const card = cardsById.get(id)!
      return `${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**`
    }).join('\n')

    const messageId = await reply(ctx, {
      content: `🗑 Descartar ${uniqueIds.length > 1 ? `${uniqueIds.length} cards` : 'este card'}?\n\n${list}\n\nVocê receberá **${estimatedTotal}** moedas. Essa ação não pode ser desfeita.`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const selection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    const confirmedMessageId = selection?.messageId ?? messageId
    if (confirmedMessageId) await deleteMsg(ctx, confirmedMessageId)
    if (!selection?.value) return

    const result = await CardsDB.discardUserCards(user.id, uniqueIds)
    if (!result.ok) {
      await reply(ctx, `Você não possui mais o card \`${result.cardId}\`. Nenhum card foi removido.`)
      return
    }

    await reply(ctx, `🗑 ${uniqueIds.length > 1 ? `${uniqueIds.length} cards descartados` : 'Card descartado'}. Você recebeu **${result.totalCoinsAwarded}** moedas.`)
  }
}
