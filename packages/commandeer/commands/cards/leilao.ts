import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { AuctionsDB, computeMinimumBid } from '@girae/database/auctions'
import { resolveCardByIdOrName } from '../../services/commandArguments'
import { getBotUsername } from '../../services/botInfo'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'
import { EMOJI } from '../../constants'

const CONFIRM_EVENT = 'leilao:confirm'

const STATUS_LABEL: Record<string, string> = {
  sold: 'Vendido',
  expired: 'Expirado',
  cancelled: 'Cancelado',
}

// mirrors AuctionsDB.createAuction's reason union.
const CREATE_FAILURE_MESSAGES: Record<string, string> = {
  auctions_disabled: `${EMOJI.auction} Os leilões estão temporariamente desativados. Tenta mais tarde.`,
  daily_limit: `${EMOJI.auction} Você já criou o **máximo de 3** leilões hoje. Tenta amanhã!`,
  rarity_not_configured: '😅 Essa raridade ainda não está configurada pra leilão. Fala com a staff.',
  not_owned: '😂 Leiloa o quê? Você não tem esse card marcado como trocável (ou não tem ele).',
  // cooldown is handled dynamically below (needs the actual time remaining), not from this map.
  already_active: `${EMOJI.auction} **OPS!** Este card já está em um leilão ativo.`,
}

// fallback if placeBid still fails after the interactive corrections below (e.g. someone else bid higher while a confirm dialog was open).
function bidFailureMessage(reason: string, capPrice: number, minimum: number): string {
  switch (reason) {
    case 'not_found': return '❌ **Leilão não encontrado!**'
    case 'not_active': return '⏳ Este leilão já não está ativo.'
    case 'expired': return '_Lance cancelado_'
    case 'self_bid': return 'Você não pode dar lance no seu próprio leilão... Está tentando dar o golpe? 😂'
    case 'self_rebid': return '❌ **Lance extra cancelado!**'
    case 'insufficient_coins': return '💸 Moedas insuficientes! E vamos de `/daily`, `/del` ou `/pix`?'
    case 'not_a_valid_step':
    case 'below_minimum':
      return `⚠️ **Valor invalido!** O lance mínimo agora é de **${minimum} moedas**.`
    case 'above_cap':
      return `⚠️ **Valor Acima do Teto!** O valor máximo é de **${capPrice} moedas**.`
    case 'auctions_disabled': return '🔨 Os leilões estão temporariamente desativados.'
    default: return '😅 Não deu pra registrar seu lance.'
  }
}

export default class LeilaoCommand extends Command {
  static override info = {
    name: 'leilao',
    description: 'Cria, cancela, mostra ou dá lance em leilões de cards',
    usage: '/leilao [<ID> | criar <id ou nome do card> | cancelar [ID] | lance <ID> [valor]]',
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'rest', type: CommandArgumentType.STRING, nullable: true, description: 'ID do leilão, ou "criar"/"cancelar"/"lance" + argumentos' }])
  static override async execute(ctx: IncomingCommand, args: { rest?: string }) {
    const tokens = (args.rest ?? '').split(/\s+/).filter(Boolean)
    const first = tokens[0]?.toLowerCase()

    if (!first) { await LeilaoCommand.handleLink(ctx); return }
    if (first === 'criar') { await LeilaoCommand.handleCreate(ctx, tokens.slice(1)); return }
    if (first === 'cancelar') { await LeilaoCommand.handleCancel(ctx, tokens[1]); return }
    if (first === 'lance') { await LeilaoCommand.handleBid(ctx, tokens[1], tokens[2]); return }
    if (/^\d+$/.test(first)) { await LeilaoCommand.handleShow(ctx, parseInt(first, 10)); return }

    await reply(ctx, 'Uso: `/leilao [<ID> | criar <id ou nome do card> | cancelar [ID] | lance <ID> [valor]>]`')
  }

  private static async handleLink(ctx: IncomingCommand) {
    const botUsername = await getBotUsername()
    await reply(ctx, `${EMOJI.auction} [Veja os leilões aqui](https://t.me/${botUsername}/leilao)`)
  }

  private static async handleCreate(ctx: IncomingCommand, tokens: string[]) {
    if (tokens.length === 0) { await reply(ctx, 'Uso: `/leilao criar <id ou nome do card>`'); return }

    const outcome = await resolveCardByIdOrName(tokens.join(' '))
    if (!outcome.ok) {
      if (!outcome.handled) await reply(ctx, outcome.message ?? 'Uso: `/leilao criar <id ou nome do card>`')
      return
    }
    const card = outcome.value as { id: number; name: string; rarityEmoji: string; imageUrl: string | null; subcategoryName: string | null }

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const preview = await AuctionsDB.previewAuctionTerms(card.id)
    if (!preview) { await reply(ctx, CREATE_FAILURE_MESSAGES.rarity_not_configured!); return }
    const saleFeePercent = Math.round(preview.saleFeeRate * 100)

    await reply(ctx, {
      content: [
        '📣 **ATENÇÃO!**',
        `Está prestes a iniciar o leilão de ${card.rarityEmoji}. **${escapeMarkdown(card.name)}**!`,
        '',
        '',
        `💵 **Lance inicial**: ${preview.startingBid} moedas`,
        `🚀 **Teto**: ${preview.capPrice} moedas`,
        '',
        `🏷️ Quando vender, é cobrada uma taxa de **${saleFeePercent}%** sobre o valor recebido.`,
        '',
        '⚠️ _A sua carta ficará bloqueada até o leilão terminar._',
      ].join('\n'),
      photoUrl: card.imageUrl ?? undefined,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true, color: 'success' }, { title: '❌ Cancelar', data: false, color: 'danger' }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) { await reply(ctx, '_Leilão cancelado_'); return }

    const result = await AuctionsDB.createAuction(user.id, card.id)
    if (!result.ok) {
      if (result.reason === 'cooldown') {
        const minutesLeft = Math.ceil((result.retryAfterMs ?? 0) / 60000)
        const waitPhrase = (result.retryAfterMs ?? 0) < 60000 ? '**menos de um minuto**' : `**${minutesLeft} minutos**`
        await reply(ctx, `⌛️ Aguarde um momento!\n\nVocê leiloou este card recentemente.\nTem de esperar ${waitPhrase} para voltar a leiloar`)
        return
      }
      await reply(ctx, CREATE_FAILURE_MESSAGES[result.reason] ?? '😅 Não deu pra criar o leilão.')
      return
    }

    await reply(ctx, {
      content: [
        `${EMOJI.auction} \`${result.auction.id}\`. **Leilão de ${escapeMarkdown(user.displayName)}**`,
        '',
        `🎉 Sucesso! O leilão de **${escapeMarkdown(card.name)}** foi criado.`,
        '',
        `🔍Para acompanhar o progresso, use \`/leilao ${result.auction.id}\`.`,
      ].join('\n'),
      photoUrl: card.imageUrl ?? undefined,
    })
  }

  private static async handleCancel(ctx: IncomingCommand, idRaw?: string) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    let id: number
    if (!idRaw) {
      const active = await AuctionsDB.listActiveAuctions({ sellerId: user.id, status: 'active' })
      if (active.total === 0) { await reply(ctx, 'Você não tem nenhum leilão ativo pra cancelar.'); return }
      if (active.total > 1) {
        const lines = active.rows.map(r => `${r.rarityEmoji} \`${r.auction.id}\`. **${escapeMarkdown(r.cardName)}**`)
        await reply(ctx, `Você tem mais de um leilão ativo. Especifica qual: \`/leilao cancelar <ID>\`\n\n${lines.join('\n')}`)
        return
      }
      id = active.rows[0]!.auction.id
    } else {
      const parsed = parseInt(idRaw, 10)
      if (isNaN(parsed)) { await reply(ctx, 'Uso: `/leilao cancelar [ID do leilão]`'); return }
      id = parsed
    }

    const details = await AuctionsDB.getAuction(id)
    if (!details) { await reply(ctx, '❌ **Leilão não encontrado!**'); return }
    if (details.auction.sellerId !== user.id) { await reply(ctx, 'Cancelar o que? este card não é seu 😂'); return }
    if (details.auction.status !== 'active') { await reply(ctx, '⏳ Este leilão já não está ativo.'); return }

    const bidWarning = details.auction.currentBidderId !== null
      ? `\n\n💸 O lance de **${details.auction.currentBid} moedas** do maior licitante será devolvido a ele.`
      : ''

    await reply(ctx, {
      content: [
        '⚠️ **Confirmar Cancelamento**',
        '',
        `Deseja cancelar o **Leilão \`${id}\` (${details.rarityEmoji} ${escapeMarkdown(details.cardName)})**?`,
        bidWarning,
      ].join('\n'),
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '❌ Cancelar leilão', data: true, color: 'danger' }, { title: '↩️ Voltar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) return

    const result = await AuctionsDB.cancelAuction(id, user.id, { asAdmin: false })
    if (!result.ok) {
      const message = result.reason === 'not_owner' ? 'Cancelar o que? este card não é seu 😂' : '❌ **Leilão não encontrado!**'
      await reply(ctx, message)
      return
    }

    await reply(ctx, `✅ **Leilão \`${id}\` cancelado.**\nCard devolvido à sua coleção!`)
  }

  private static async handleBid(ctx: IncomingCommand, auctionIdRaw?: string, amountRaw?: string) {
    const auctionId = parseInt(auctionIdRaw ?? '', 10)
    if (!auctionIdRaw || isNaN(auctionId)) { await reply(ctx, 'Uso: `/leilao lance <ID do leilão> [valor]`'); return }

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const details = await AuctionsDB.getAuction(auctionId)
    if (!details) { await reply(ctx, '❌ **Leilão não encontrado!**'); return }
    if (details.auction.status !== 'active') { await reply(ctx, '⏳ Este leilão já não está ativo.'); return }
    if (details.auction.sellerId === user.id) { await reply(ctx, 'Você não pode dar lance no seu próprio leilão... Está tentando dar o golpe? 😂'); return }

    const minimum = computeMinimumBid(details.auction)

    // no amount given -> use the current minimum directly, no confirmation needed
    let amount: number
    if (amountRaw === undefined) {
      amount = minimum
    } else if (!/^\d+$/.test(amountRaw.trim())) {
      if (!await LeilaoCommand.confirm(ctx, `⚠️ **Valor invalido!** Quer que eu coloque o menor lance possível? (**${minimum} moedas**)`)) {
        await reply(ctx, '❌ **Lance cancelado!**')
        return
      }
      amount = minimum
    } else {
      amount = parseInt(amountRaw, 10)
    }

    // validate/correct the amount before the self-rebid confirm, so an invalid amount doesn't get quoted as a legitimate raise and then immediately re-flagged.
    if (amount % details.auction.bidIncrement !== 0 || amount < minimum) {
      if (!await LeilaoCommand.confirm(ctx, `⚠️ **Valor invalido!** Quer que eu coloque o menor lance possível? (**${minimum} moedas**)`)) {
        await reply(ctx, '❌ **Lance cancelado!**')
        return
      }
      amount = minimum
    }

    if (amount > details.auction.capPrice) {
      if (!await LeilaoCommand.confirm(ctx, `⚠️ **Valor Acima do Teto!** O valor máximo é de **${details.auction.capPrice} moedas**. Deseja ajustar o seu lance para o teto?`)) {
        await reply(ctx, '❌ **Lance cancelado!**')
        return
      }
      amount = details.auction.capPrice
    }

    let allowSelfRebid = false
    if (details.auction.currentBidderId === user.id) {
      if (!await LeilaoCommand.confirm(ctx, `💸 **Confirmar Lance Maior**\n\nVocê já é o maior licitante! Tem certeza de que quer pagar mais **${amount} moedas** neste leilão?`)) {
        await reply(ctx, '❌ **Lance extra cancelado!**')
        return
      }
      allowSelfRebid = true
    }

    const result = await AuctionsDB.placeBid(auctionId, user.id, amount, { allowSelfRebid })
    if (!result.ok) {
      await reply(ctx, bidFailureMessage(result.reason, details.auction.capPrice, minimum))
      return
    }

    if (result.settled) {
      await reply(ctx, [
        '🚀 **Teto Atingido!**',
        '',
        `🔨 Com o lance de **${amount} moedas**, você alcançou o valor máximo e arrematou o leilão \`${auctionId}\`!`,
        '',
        `🎉 **Parabéns!** ${details.rarityEmoji} **${escapeMarkdown(details.cardName)}** **agora é sua**!`,
      ].join('\n'))
      return
    }

    await reply(ctx, [
      '🔨 **Lance Registrado!**',
      '',
      `Você deu um lance de **${amount} moedas** no leilão \`${auctionId}\` (${details.rarityEmoji} **${escapeMarkdown(details.cardName)}**)!`,
      '',
      '🏆 **Você é o maior licitante agora.**',
    ].join('\n'))
  }

  private static async handleShow(ctx: IncomingCommand, auctionId: number) {
    const details = await AuctionsDB.getAuction(auctionId)
    if (!details) { await reply(ctx, '🔍 Não encontrei um leilão com esse ID.'); return }
    const { auction, cardName, cardImageUrl, rarityEmoji, sellerName, categoryEmoji, subcategoryName } = details

    const bidLabel = auction.currentBid !== null ? 'Lance atual' : 'Lance inicial'
    const bidAmount = auction.currentBid ?? auction.startingBid

    let topBidderLine = '🏆 **Maior licitante**: _Nenhum lance ainda_'
    if (auction.currentBidderId !== null) {
      const bidder = await UsersDB.getUserById(auction.currentBidderId)
      const bidderName = bidder?.displayName ?? 'alguém'
      const platformId = await UsersDB.getPlatformIdForUser(auction.currentBidderId, ctx.message.platform as 'telegram' | 'discord')
      const bidderDisplay = platformId ? mention(ctx.message.platform as 'telegram' | 'discord', platformId, bidderName) : `**${escapeMarkdown(bidderName)}**`
      topBidderLine = `🏆 **Maior licitante**: \`${auction.currentBidderId}\`. ${bidderDisplay}`
    }

    const timeLine = auction.status === 'active'
      ? `⏳ **__Tempo restante__**: _**${Math.max(0, Math.round((auction.expiresAt.getTime() - Date.now()) / 60000))}min**_`
      : `⏳ **__Estado__**: _**${STATUS_LABEL[auction.status] ?? auction.status}**_`

    const content = [
      `${EMOJI.auction} **Leilão** \`${auction.id}\``,
      '',
      `${rarityEmoji} \`${auction.cardId}\`. **${escapeMarkdown(cardName)}**`,
      `${categoryEmoji} _${escapeMarkdown(subcategoryName)}_`,
      '',
      `👤 **__Vendedor__**: ${escapeMarkdown(sellerName)}`,
      `💰 **__${bidLabel}__**: ${bidAmount} moedas`,
      `🚀 **__Teto__**: ${auction.capPrice} moedas`,
      '',
      topBidderLine,
      timeLine,
    ].join('\n')

    let buttons: { text: string; runCommand: { name: string; args: string[] } }[] | undefined
    if (auction.status === 'active') {
      const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
      const minimum = computeMinimumBid(auction)
      // omit the button entirely rather than let it lead to a predictable placeBid failure (no money, own auction).
      if (user && user.id !== auction.sellerId && user.coins >= minimum) {
        buttons = [{ text: '💰 Dar lance', runCommand: { name: 'leilao', args: ['lance', String(auction.id)] } }]
      }
    }

    await reply(ctx, { content, photoUrl: cardImageUrl ?? undefined, buttons })
  }

  private static async confirm(ctx: IncomingCommand, content: string): Promise<boolean> {
    await reply(ctx, {
      content,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true, color: 'success' }, { title: '❌ Cancelar', data: false, color: 'danger' }],
    })
    const selection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (selection?.messageId) await deleteMsg(ctx, selection.messageId)
    return selection?.value ?? false
  }
}
