import { Command, QuickView, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { getActiveTradeSide } from './trade.cards'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

const FALLBACK_IMAGE = 'https://placehold.co/900x1260/png'

async function showCard(ctx: IncomingCommand, card: CardDetails) {
  const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
  const [owned, tags] = await Promise.all([
    user ? CardsDB.getUserCard(user.id, card.id) : null,
    CardsDB.getSecondarySubcategoryNames(card.id),
  ])
  const count = owned?.count ?? 0
  const badge = cativeiroEmoji(count)

  const tagLine = tags.length > 0 ? `\n${EMOJI.tag} ${tags.map(escapeMarkdown).join(', ')}` : ''
  const countSuffix = count > 0 ? ` (\`${count}x\`)` : ''

  const text = `${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**${badge ? ` ${badge}` : ''}
${card.categoryEmoji ?? EMOJI.category} _${escapeMarkdown(card.subcategoryName ?? '?')}_${tagLine}

${EMOJI.owner} \`${user?.id ?? '?'}\`. [${escapeMarkdown(ctx.message.author.name)}](tg://user?id=${ctx.message.author.id})${countSuffix}`

  const buttonRows = [[{ text: EMOJI.quickView, quickView: { handler: 'cardinfo', arg: String(card.id) } }]]

  const activeTrade = await getActiveTradeSide(ctx.message.author.id)
  if (activeTrade) {
    const inOffer = !!activeTrade.state.offers[activeTrade.side][card.id]
    if (!inOffer && count > 0) {
      buttonRows.push([{ text: '➕ Trocar este card', quickView: { handler: 'tradeCard', arg: `add:${card.id}` } }])
    }
    if (inOffer) {
      buttonRows.push([{ text: '➖ Retirar este card da troca', quickView: { handler: 'tradeCard', arg: `remove:${card.id}` } }])
    }
  }

  await reply(ctx, {
    content: text,
    photoUrl: card.imageUrl ?? FALLBACK_IMAGE,
    buttonRows,
  })
}

export default class CardCommand extends Command {
  static override info = {
    name: 'card',
    description: 'Busca e visualiza informações de uma carta',
    usage: '/card <nome ou ID do personagem>',
    aliases: ['view', 'ver'],
  }

  @CommandArgument([{ name: 'card', type: CommandArgumentType.CARD }])
  static override async execute(ctx: IncomingCommand, args: { card: CardDetails }) {
    await showCard(ctx, args.card)
  }

  @QuickView({ name: 'cardinfo' })
  static async cardinfo(arg: string): Promise<string> {
    const cardId = parseInt(arg, 10)
    const card = await CardsDB.getCardWithDetails(cardId)
    if (!card) return 'Não encontrei esse card.'

    const [owners, copies] = await Promise.all([
      CardsDB.getCardOwnerCount(cardId),
      CardsDB.getCardTotalCopies(cardId),
    ])

    return `${card.rarityEmoji} Informações de ${card.name}

${EMOJI.ownersCount} ${owners} pessoa${owners === 1 ? '' : 's'} com este card
${EMOJI.circulation} ${copies} vez${copies === 1 ? '' : 'es'} girado`
  }
}
