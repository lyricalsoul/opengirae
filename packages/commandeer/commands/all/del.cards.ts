import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { CARD_DISCARD_REWARDS } from '@girae/database/constants'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'del:confirm'
const MAX_CARDS_PER_REQUEST = 50

export default class DelCommand extends Command {
  static override info = {
    name: 'del',
    description: 'Descarta um ou mais cards em troca de moedas',
    usage: '/del <ID> [ID2] [ID3] ...',
    aliases: ['deletar'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'ids', type: CommandArgumentType.STRING }])
  static override async execute(ctx: IncomingCommand, args: { ids: string }) {
    const tokens = args.ids.split(/\s+/).filter(Boolean)

    if (tokens.length > MAX_CARDS_PER_REQUEST) {
      await reply(ctx, `Você só pode descartar até ${MAX_CARDS_PER_REQUEST} cards de uma vez.`)
      return
    }

    const cardIds: number[] = []
    for (const token of tokens) {
      if (!/^\d+$/.test(token)) {
        await reply(ctx, `\`${escapeMarkdown(token)}\` não é um ID de card válido. Nenhum card foi removido.`)
        return
      }
      cardIds.push(parseInt(token, 10))
    }

    // a repeated ID means "discard that many copies" (e.g. `864 864` = 2x card 864)
    const requestedQty = new Map<number, number>()
    for (const id of cardIds) requestedQty.set(id, (requestedQty.get(id) ?? 0) + 1)

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const owned = await CardsDB.getOwnedCardQuantities(user.id, [...requestedQty.keys()])
    const ownedCountById = new Map(owned.map(o => [o.cardId, o.count]))

    // keep only IDs where the user actually has enough copies for what was requested
    const finalIds: number[] = []
    for (const [cardId, qty] of requestedQty) {
      const have = ownedCountById.get(cardId) ?? 0
      if (have >= qty) {
        for (let i = 0; i < qty; i++) finalIds.push(cardId)
      }
    }

    if (finalIds.length === 0) {
      await reply(ctx, 'Você não possui esses cards em quantidade suficiente.')
      return
    }

    const finalQty = new Map<number, number>()
    for (const id of finalIds) finalQty.set(id, (finalQty.get(id) ?? 0) + 1)
    const uniqueFinalIds = [...finalQty.keys()]

    const cards = await CardsDB.getCardsByIds(uniqueFinalIds)
    const cardsById = new Map(cards.map(c => [c.id, c]))

    const estimatedTotal = finalIds.reduce((sum, id) => sum + (CARD_DISCARD_REWARDS[cardsById.get(id)!.rarityName] ?? 0), 0)
    const list = uniqueFinalIds.map(id => {
      const card = cardsById.get(id)!
      const qty = finalQty.get(id)!
      return `${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**${qty > 1 ? ` (\`${qty}x\`)` : ''}`
    }).join('\n')

    const messageId = await reply(ctx, {
      content: `🗑 Descartar ${finalIds.length > 1 ? `${finalIds.length} cards` : 'este card'}?\n\n${list}\n\nVocê receberá **${estimatedTotal}** moedas. Essa ação não pode ser desfeita.`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const selection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    const confirmedMessageId = selection?.messageId ?? messageId

    if (!selection?.value) {
      if (confirmedMessageId) await reply(ctx, { content: '❌ Descarte cancelado.', editMessageId: confirmedMessageId })
      return
    }

    const result = await CardsDB.discardUserCards(user.id, finalIds)
    if (!result.ok) {
      await reply(ctx, {
        content: `Você não possui mais o card \`${result.cardId}\` em quantidade suficiente. Nenhum card foi removido.`,
        editMessageId: confirmedMessageId,
      })
      return
    }

    await reply(ctx, {
      content: `🗑 ${finalIds.length > 1 ? `${finalIds.length} cards descartados` : 'Card descartado'}. Você recebeu **${result.totalCoinsAwarded}** moedas.`,
      editMessageId: confirmedMessageId,
    })
  }
}
