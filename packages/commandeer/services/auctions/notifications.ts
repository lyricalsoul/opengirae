import { AuctionsDB, type Auction } from '@girae/database/auctions'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { reply } from '@girae/common/dbos/messaging'
import { buildCtx } from '../syntheticCtx'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import type { Platform } from '@girae/common/commands/types'

// a user can be linked on both platforms - DM whichever one they're actually reachable on, telegram first.
async function dmUser(userId: number, displayName: string, content: string) {
  for (const platform of ['telegram', 'discord'] as Platform[]) {
    const platformId = await UsersDB.getPlatformIdForUser(userId, platform)
    if (!platformId) continue
    await reply(buildCtx(platform, platformId, displayName, platformId), content)
    return
  }
}

async function displayNameFor(userId: number): Promise<string> {
  const user = await UsersDB.getUserById(userId)
  return user?.displayName ?? 'alguém'
}

// drains the outbid-notification outbox (auctionBids.notifiedAt) - a bid can be triggered from the website's tRPC layer, which has no messaging access, so this can't be inline in placeBid.
export async function sendOutbidNotifications(limit = 50): Promise<void> {
  const pending = await AuctionsDB.listUnnotifiedBids(limit)
  for (const bid of pending) {
    const auctionDetails = await AuctionsDB.getAuction(bid.auctionId)
    if (!auctionDetails) continue
    const displayName = await displayNameFor(bid.bidderId)
    const cardName = escapeMarkdown(auctionDetails.cardName)
    await dmUser(
      bid.bidderId, displayName,
      [
        '⚠️ **Lance Superado!**',
        '',
        `🔨 Seu lance de **${bid.amount} moedas** no leilão \`${bid.auctionId}\` (${auctionDetails.rarityEmoji} **${cardName}**) foi ultrapassado.`,
        '',
        `📈 **Lance atual:** **${auctionDetails.auction.currentBid} moedas**`,
      ].join('\n'),
    )
    await AuctionsDB.markBidNotified(bid.id)
  }
}

async function describeResolution(auction: Auction, cardName: string, rarityEmoji: string): Promise<void> {
  const sellerName = await displayNameFor(auction.sellerId)
  const escapedCardName = escapeMarkdown(cardName)

  if (auction.status === 'sold') {
    const feeLine = auction.saleFeePaid ? `\n💸 Taxa de venda: **${auction.saleFeePaid} moedas**\n💰 Você recebeu: **${auction.currentBid! - auction.saleFeePaid} moedas**` : ''
    await dmUser(auction.sellerId, sellerName, [
      '🎉 **Item Vendido!**',
      '',
      `🔨 O seu leilão \`${auction.id}\` (${rarityEmoji} **${escapedCardName}**) foi arrematado por **${auction.currentBid} moedas**${feeLine}`,
    ].join('\n'))
    if (auction.currentBidderId !== null) {
      const winnerName = await displayNameFor(auction.currentBidderId)
      await dmUser(auction.currentBidderId, winnerName, [
        '🏆 **Leilão Arrematado!**',
        '',
        `🎉 Você venceu o leilão \`${auction.id}\`! `,
        '',
        `${rarityEmoji} **${escapedCardName}** já está guardada na sua coleção.✨`,
      ].join('\n'))
    }
    return
  }

  if (auction.status === 'expired') {
    await dmUser(auction.sellerId, sellerName, [
      '⌛️ **Leilão Encerrado!**',
      '',
      `O leilão \`${auction.id}\` (${rarityEmoji} **${escapedCardName}**) fechou sem nenhum lance.`,
      '',
      '📦 O card já voltou para a sua coleção!',
    ].join('\n'))
    return
  }

  if (auction.status === 'cancelled') {
    await dmUser(auction.sellerId, sellerName, [
      '❌ **Leilão Cancelado!**',
      '',
      `O seu leilão \`${auction.id}\` (${rarityEmoji} **${escapedCardName}**) foi cancelado.`,
      '',
      '📦 O card já voltou para a sua coleção!',
    ].join('\n'))
    if (auction.currentBidderId !== null) {
      const bidderName = await displayNameFor(auction.currentBidderId)
      await dmUser(auction.currentBidderId, bidderName, [
        '❌ **Leilão Cancelado!**',
        '',
        `O leilão \`${auction.id}\` (${rarityEmoji} **${escapedCardName}**) foi cancelado pelo criador.`,
        '',
        '💰 Suas moedas já foram devolvidas para a sua conta!',
      ].join('\n'))
    }
  }
}

// drains the sold/expired/cancelled notification outbox (auctions.resolutionNotifiedAt) - same reasoning as sendOutbidNotifications.
export async function sendResolutionNotifications(limit = 50): Promise<void> {
  const pending = await AuctionsDB.listUnnotifiedResolutions(limit)
  for (const auction of pending) {
    const card = await CardsDB.getCardWithDetails(auction.cardId)
    if (!card) continue
    await describeResolution(auction, card.name, card.rarityEmoji)
    await AuctionsDB.markResolutionNotified(auction.id)
  }
}
