import { Command, QuickView, Page, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply, type ButtonSpec } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { AuctionsDB } from '@girae/database/auctions'
import { UsersDB } from '@girae/database/users'
import { getActiveTradeSide } from './trade'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'
import { resolveDisplayEmoji } from '@girae/common/utilities/customEmoji'

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

export const FALLBACK_IMAGE = 'https://placehold.co/900x1260/png'

const CARD_SEARCH_PAGE_SIZE = 10

const OBSCURE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function randomObscuredName(): string {
  return Array.from({ length: 64 }, () => OBSCURE_CHARS[Math.floor(Math.random() * OBSCURE_CHARS.length)]).join('')
}

export async function renderCardSearchResults(query: string, page: number) {
  const results = await CardsDB.searchCardsByName(query, 100)
  const totalPages = Math.max(1, Math.ceil(results.length / CARD_SEARCH_PAGE_SIZE))
  const slice = results.slice(page * CARD_SEARCH_PAGE_SIZE, (page + 1) * CARD_SEARCH_PAGE_SIZE)
  const lines = slice.map(c => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** ${c.categoryEmoji ?? ''} _${escapeMarkdown(c.subcategoryName ?? '')}_`)
  const pageInfo = totalPages > 1 ? `\n\n${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**` : ''

  return {
    content: `🔎 **${results.length}** resultados encontrados:\n\n${lines.join('\n')}${pageInfo}\n\nUse o ID para especificar.`,
    hasNext: page < totalPages - 1,
    totalPages,
  }
}

async function showCard(ctx: IncomingCommand, card: CardDetails) {
  const activeTradePromise = getActiveTradeSide(ctx.message.author.id)
  const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
  const [owned, tags, activeAuction] = await Promise.all([
    user ? CardsDB.getUserCard(user.id, card.id) : null,
    CardsDB.getSecondarySubcategoryNames(card.id),
    user ? AuctionsDB.getActiveAuctionForSellerCard(user.id, card.id) : null,
  ])
  // a unit currently in this user's own /leilao is physically out of userCards (see
  // AuctionsDB.createAuctionTx) but still theirs - count it back in instead of showing 0x.
  const inAuction = !!activeAuction
  const count = (owned?.count ?? 0) + (inAuction ? 1 : 0)
  const badge = cativeiroEmoji(count)
  const rarityOrCustom = resolveDisplayEmoji(owned?.customEmoji, card.rarityEmoji, ctx.message.platform === 'telegram')
  const obscured = !!user?.obscureMode
  const displayName = obscured ? randomObscuredName() : card.name

  const subcategoryNames = [card.subcategoryName ?? '?', ...tags].map(escapeMarkdown).join(' / ')
  const countSuffix = count > 0 ? ` (\`${count}x\`)` : ''
  const auctionSuffix = inAuction ? ` (${EMOJI.inAuction})` : ''

  const text = `${rarityOrCustom} \`${card.id}\`. **${escapeMarkdown(displayName)}**${badge ? ` ${badge}` : ''}
${card.categoryEmoji ?? EMOJI.category} _${subcategoryNames}_

${EMOJI.owner} \`${user?.id ?? '?'}\`. ${mention(ctx.message.platform, ctx.message.author.id, ctx.message.author.name)}${countSuffix}${auctionSuffix}`

  const buttonRows: ButtonSpec[][] = [[{ text: EMOJI.quickView, quickView: { handler: 'cardinfo', arg: String(card.id) } }]]

  const activeTrade = await activeTradePromise
  if (activeTrade) {
    const inOffer = !!activeTrade.state.offers[activeTrade.side][card.id]
    if (!inOffer && count > 0) {
      buttonRows.push([{ text: '➕ Trocar este card', quickView: { handler: 'tradeCard', arg: `add:${card.id}` }, color: 'success' }])
    }
    if (inOffer) {
      buttonRows.push([{ text: '➖ Retirar este card da troca', quickView: { handler: 'tradeCard', arg: `remove:${card.id}` }, color: 'danger' }])
    }
  }

  await reply(ctx, {
    content: text,
    photoUrl: obscured ? FALLBACK_IMAGE : (owned?.customMediaUrl ?? card.imageUrl ?? FALLBACK_IMAGE),
    isVideo: obscured ? false : owned?.customMediaType === 'video',
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

  @CommandArgument([{ name: 'card', type: CommandArgumentType.CARD, paginatedAmbiguous: true, description: 'ID ou nome do personagem' }])
  static override async execute(ctx: IncomingCommand, args: { card: CardDetails }) {
    await showCard(ctx, args.card)
  }

  @Page({ name: 'cardsearch', restricted: true })
  static async cardSearchPage(arg: string, page: number) {
    return renderCardSearchResults(arg, page)
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
