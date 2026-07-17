import { Command, QuickView, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB, InsufficientCardError } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { reply, deleteMsg, awaitMultiPartyChoice } from '@girae/common/dbos/messaging'
import { generateTradeImage } from '@girae/common/ditto'
import { refreshAvatar } from '@girae/common/avatarRefresh'
import { DEFAULT_AVATAR_URL } from '@girae/database/constants'
import { getBotUsername, tg } from '../../services/botInfo'
import { rawClient } from '@girae/common/queue'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { error } from '@girae/common/logger'

const LOCK_TTL_SECONDS = 60 * 60
const INACTIVITY_TIMEOUT_SECONDS = 30 * 60
const MAX_CARDS_PER_SIDE = 3

export const INVITE_EVENT = 'trade:invite'
export const FINALIZE_EVENT = 'trade:finalize'
export const NEGOTIATION_TOPIC = 'trade:negotiation'

type Side = 'proposer' | 'target'
type Offer = Record<number, number>

interface TradeState {
  proposerTelegramId: string
  targetTelegramId: string
  offers: Record<Side, Offer>
  ready: Record<Side, boolean>
  dmChat: Partial<Record<Side, string>>
  dmMessageId: Partial<Record<Side, string>>
}

interface NegotiationEvent {
  type: 'dmOpened' | 'stateChanged'
  clickerUserId: string
  chatId?: string
}

const lockKey = (telegramId: string) => `trade:lock:${telegramId}`
const stateKey = (workflowID: string) => `trade:state:${workflowID}`

async function tryAcquireLock(telegramId: string, value: { workflowID: string; partnerId: string }): Promise<boolean> {
  const result = await rawClient.set(lockKey(telegramId), JSON.stringify(value), { EX: LOCK_TTL_SECONDS, NX: true })
  return result === 'OK'
}
const mention = (telegramId: string, name: string) => `[${escapeMarkdown(name)}](tg://user?id=${telegramId})`

async function loadState(workflowID: string): Promise<TradeState | null> {
  const raw = await rawClient.get(stateKey(workflowID))
  return raw ? JSON.parse(raw) : null
}

async function saveState(workflowID: string, state: TradeState) {
  await rawClient.set(stateKey(workflowID), JSON.stringify(state), { EX: LOCK_TTL_SECONDS })
}

function groupMessageLink(chatId: string, messageId: string): string {
  const idNum = Number(chatId)
  if (isNaN(idNum)) return `https://t.me/${chatId.replace('@', '')}/${messageId}`
  const stripped = chatId.startsWith('-100') ? chatId.slice(4) : chatId.replace('-', '')
  return `https://t.me/c/${stripped}/${messageId}`
}

function sideCtx(base: IncomingCommand, telegramId: string, name: string, chatId: string): IncomingCommand {
  return {
    ...base,
    message: {
      ...base.message,
      id: '',
      author: { id: telegramId, name, avatarUrl: '' },
      chat: { id: chatId, title: 'DM' },
    },
  }
}

export async function getActiveTradeSide(telegramId: string): Promise<{ workflowID: string; state: TradeState; side: Side } | null> {
  const lockRaw = await rawClient.get(lockKey(telegramId))
  if (!lockRaw) return null
  const { workflowID } = JSON.parse(lockRaw)

  const state = await loadState(workflowID)
  if (!state) return null

  const side: Side = telegramId === state.targetTelegramId ? 'target' : 'proposer'
  return { workflowID, state, side }
}

export async function modifyTradeOffer(telegramId: string, cardId: number, action: 'add' | 'remove'): Promise<string> {
  const active = await getActiveTradeSide(telegramId)
  if (!active) return 'Você não está em uma troca de cartas...'
  const { workflowID, state, side } = active

  const clickerUser = await UsersDB.getUserByTelegramId(telegramId)
  if (!clickerUser) return 'Erro ao processar.'

  if (action === 'add') {
    const owned = await CardsDB.getUserCard(clickerUser.id, cardId)
    const ownedCount = owned?.count ?? 0
    if (ownedCount === 0) return 'Você não tem essa carta...'

    const alreadyInOffer = state.offers[side][cardId] ?? 0
    if (alreadyInOffer >= ownedCount) {
      const card = await CardsDB.getCard(cardId)
      return `Você não pode adicionar mais ${card?.name ?? 'cartas'}s à troca - você já colocou todos os que tem! 😅`
    }

    const totalInOffer = Object.values(state.offers[side]).reduce((a, b) => a + b, 0)
    if (totalInOffer >= MAX_CARDS_PER_SIDE) return 'Você só pode trocar 3 cards de uma vez! 😅'

    state.offers[side][cardId] = alreadyInOffer + 1
    await saveState(workflowID, state)
    await DBOS.send<NegotiationEvent>(workflowID, { type: 'stateChanged', clickerUserId: telegramId }, NEGOTIATION_TOPIC)
    return 'Carta adicionada.'
  }

  if (!state.offers[side][cardId]) return 'Essa carta não está na troca! 😅'
  if (state.offers[side][cardId] <= 1) delete state.offers[side][cardId]
  else state.offers[side][cardId] -= 1
  await saveState(workflowID, state)
  await DBOS.send<NegotiationEvent>(workflowID, { type: 'stateChanged', clickerUserId: telegramId }, NEGOTIATION_TOPIC)
  return 'Carta removida.'
}

async function formatOffer(offer: Offer): Promise<string> {
  const entries = Object.entries(offer)
  if (entries.length === 0) return '_Nenhum card até agora._'
  const lines = await Promise.all(entries.map(async ([cardIdStr, count]) => {
    const cardId = Number(cardIdStr)
    const card = await CardsDB.getCardWithDetails(cardId)
    const label = card ? `${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**` : `\`${cardId}\`. *card removido*`
    return `${label}${count > 1 ? ` (\`${count}x\`)` : ''}`
  }))
  return lines.join('\n')
}

async function offerCardImages(offer: Offer): Promise<string[]> {
  const cards = await Promise.all(Object.keys(offer).map(id => CardsDB.getCardWithDetails(Number(id))))
  return cards.filter((c): c is NonNullable<typeof c> => !!c?.imageUrl).map(c => c.imageUrl!)
}

const FALLBACK_TRADE_IMAGE = 'https://placehold.co/1200x630/png'

async function renderTradeImage(
  state: TradeState,
  proposerAvatarUrl: string, proposerName: string,
  targetAvatarUrl: string, targetName: string,
): Promise<{ url: string }> {
  const [proposerCards, targetCards] = await Promise.all([
    offerCardImages(state.offers.proposer),
    offerCardImages(state.offers.target),
  ])
  const image = await generateTradeImage({
    user1: { avatarURL: proposerAvatarUrl, name: proposerName, cards: proposerCards },
    user2: { avatarURL: targetAvatarUrl, name: targetName, cards: targetCards },
  }).catch((e) => {
    error('trade', `generateTradeImage failed: ${e}`)
    return null
  })
  return image ?? { url: FALLBACK_TRADE_IMAGE }
}

const emptyOffersState = (proposerTelegramId: string, targetTelegramId: string): TradeState => ({
  proposerTelegramId,
  targetTelegramId,
  offers: { proposer: {}, target: {} },
  ready: { proposer: false, target: false },
  dmChat: {},
  dmMessageId: {},
})

export default class TradeCommand extends Command {
  static override info = {
    name: 'trade',
    description: 'Inicia uma troca de cartas com outro usuário',
    usage: '/trade (em resposta ao usuário, ou /trade @usuario)',
    aliases: ['trocar', 'troca'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'target', type: CommandArgumentType.USER_MENTION }])
  static override async execute(ctx: IncomingCommand, args: { target: string }) {
    const targetTelegramId = args.target

    if (targetTelegramId === ctx.message.author.id) {
      await reply(ctx, 'Você não pode trocar cartas com você mesmo! 😅')
      return
    }

    const proposerUser = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!proposerUser) return
    if (proposerUser.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode realizar trocas de cartas.')
      return
    }

    const targetUser = await UsersDB.getUserByTelegramId(targetTelegramId)
    if (!targetUser) {
      await reply(ctx, 'O usuário mencionado nunca usou a bot! Talvez você marcou a pessoa errada?')
      return
    }
    if (targetUser.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode realizar trocas de cartas.')
      return
    }

    const proposerName = proposerUser.displayName
    const targetName = targetUser.displayName
    const [refreshedProposer, refreshedTarget] = await Promise.all([
      refreshAvatar(tg, ctx.message.author.id, proposerName, { force: true }),
      refreshAvatar(tg, targetTelegramId, targetName, { force: true }),
    ])
    const proposerAvatarUrl = refreshedProposer?.avatarUrl || DEFAULT_AVATAR_URL
    const targetAvatarUrl = refreshedTarget?.avatarUrl || DEFAULT_AVATAR_URL
    const sideOf = (telegramId: string): Side => telegramId === targetTelegramId ? 'target' : 'proposer'
    const telegramIdOf = (side: Side) => side === 'proposer' ? ctx.message.author.id : targetTelegramId
    const nameOf = (side: Side) => side === 'proposer' ? proposerName : targetName

    const gotProposerLock = await tryAcquireLock(ctx.message.author.id, { workflowID: ctx.workflowIDToBeAssigned, partnerId: targetTelegramId })
    if (!gotProposerLock) {
      await reply(ctx, 'Você já está em uma troca de cartas...\nFinalize-a para trocar mais cartas.')
      return
    }
    const gotTargetLock = await tryAcquireLock(targetTelegramId, { workflowID: ctx.workflowIDToBeAssigned, partnerId: ctx.message.author.id })
    if (!gotTargetLock) {
      await rawClient.del(lockKey(ctx.message.author.id)) // release what we just acquired - don't leak a one-sided lock
      await reply(ctx, 'Esse usuário já está em uma troca de cartas...\nDeixe ele terminar para poder trocar com você.')
      return
    }

    try {
      const inviteImage = await renderTradeImage(emptyOffersState(ctx.message.author.id, targetTelegramId), proposerAvatarUrl, proposerName, targetAvatarUrl, targetName)

      const inviteResult = await awaitMultiPartyChoice<'accept' | 'decline'>(
        ctx,
        INVITE_EVENT,
        {
          content: `${mention(targetTelegramId, targetName)}, você quer trocar cartas com ${mention(ctx.message.author.id, proposerName)}?\n\n${mention(ctx.message.author.id, proposerName)}, você ainda pode cancelar clicando em recusar!`,
          photoUrl: inviteImage.url,
        },
        [{ title: '✅ Aceitar', data: 'accept' }, { title: '❌ Recusar', data: 'decline' }],
        [ctx.message.author.id, targetTelegramId],
        (c) => c.data === 'decline' || c.clickerUserId === targetTelegramId,
        INACTIVITY_TIMEOUT_SECONDS,
      )

      if (!inviteResult) {
        await reply(ctx, 'A troca expirou por inatividade. 😴')
        return
      }
      if (inviteResult.data === 'decline') {
        const declinedByTarget = inviteResult.clickerUserId === targetTelegramId
        await reply(ctx, { content: `A troca foi entre vocês foi ${declinedByTarget ? 'recusada' : 'cancelada'}. 😢`, editMessageId: inviteResult.messageId })
        return
      }

      if (!inviteResult.messageId) return // clicks always carry a messageId 
      const groupMessageId = inviteResult.messageId
      const botUsername = await getBotUsername()
      await reply(ctx, {
        content: `Hora de trocar, ${mention(ctx.message.author.id, proposerName)} e ${mention(targetTelegramId, targetName)}! 🤝\n\nCliquem no botão abaixo para inicar a troca.`,
        photoUrl: inviteImage.url,
        editMessageId: groupMessageId,
        captionOnly: true, // same photo the invite message already has
        buttons: [{ text: '💱 Iniciar troca', url: `https://t.me/${botUsername}?start=trade` }],
      })

      await saveState(ctx.workflowIDToBeAssigned, emptyOffersState(ctx.message.author.id, targetTelegramId))

      const negotiationContent = (proposerOffer: string, targetOffer: string, extra: string) =>
        `💱 Troca entre ${mention(ctx.message.author.id, proposerName)} e ${mention(targetTelegramId, targetName)}\n\n🃏 **${escapeMarkdown(proposerName)}** está oferecendo:\n\n${proposerOffer}\n\n🃏 **${escapeMarkdown(targetName)}** está oferecendo:\n\n${targetOffer}\n\n${extra}`

      const renderDM = async (side: Side, s: TradeState, proposerOffer: string, targetOffer: string, photoUrl: string) => {
        const chatId = s.dmChat[side]
        if (!chatId) return
        const dm = sideCtx(ctx, telegramIdOf(side), nameOf(side), chatId)
        const messageId = await reply(dm, {
          content: negotiationContent(proposerOffer, targetOffer, 'Quando estiverem prontos, clique no botão abaixo.\nUse `/add` ou `/remove <id ou nome>` para adicionar ou tirar cartas rapidamente.\nPara cancelar, use /clear.'),
          photoUrl,
          buttons: [{ text: '🤝 Estou pronto', quickView: { handler: 'tradeReady', arg: '' } }],
          editMessageId: s.dmMessageId[side],
        })
        if (messageId && messageId !== s.dmMessageId[side]) {
          s.dmMessageId[side] = messageId
          await saveState(ctx.workflowIDToBeAssigned, s)
        }
      }

      const renderGroupMessage = async (proposerOffer: string, targetOffer: string, photoUrl: string) => {
        await reply(ctx, {
          content: negotiationContent(proposerOffer, targetOffer, 'Cliquem no botão abaixo para participar da troca.'),
          photoUrl,
          editMessageId: groupMessageId,
          buttons: [{ text: '💱 Iniciar troca', url: `https://t.me/${botUsername}?start=trade` }],
        })
      }

      const deadline = Date.now() + INACTIVITY_TIMEOUT_SECONDS * 1000
      let negotiationTimedOut = false
      while (true) {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
        const msg = await DBOS.recv<NegotiationEvent>(NEGOTIATION_TOPIC, remaining)
        if (!msg) { negotiationTimedOut = true; break }

        const current = await loadState(ctx.workflowIDToBeAssigned)
        if (!current) { negotiationTimedOut = true; break } // state expired/cleared out from under us

        if (msg.type === 'dmOpened' && msg.chatId) {
          current.dmChat[sideOf(msg.clickerUserId)] = msg.chatId
          await saveState(ctx.workflowIDToBeAssigned, current)
        }

        const [proposerOffer, targetOffer, image] = await Promise.all([
          formatOffer(current.offers.proposer),
          formatOffer(current.offers.target),
          renderTradeImage(current, proposerAvatarUrl, proposerName, targetAvatarUrl, targetName),
        ])

        await Promise.all([
          renderDM('proposer', current, proposerOffer, targetOffer, image.url),
          renderDM('target', current, proposerOffer, targetOffer, image.url),
          renderGroupMessage(proposerOffer, targetOffer, image.url),
        ])

        if (current.ready.proposer && current.ready.target) break
      }

      if (negotiationTimedOut) {
        await deleteMsg(ctx, groupMessageId)
        await reply(ctx, 'A troca expirou por inatividade. 😴')
        return
      }

      const finalState = await loadState(ctx.workflowIDToBeAssigned)
      if (!finalState) return

      for (const side of ['proposer', 'target'] as Side[]) {
        const chatId = finalState.dmChat[side]
        if (!chatId) continue
        const dm = sideCtx(ctx, telegramIdOf(side), nameOf(side), chatId)
        await reply(dm, {
          content: 'Agora que vocês escolheram seus cards, cliquem no botão abaixo para voltar ao chat e finalizar sua troca.',
          buttons: [{ text: '🔙 Voltar à mensagem para confirmar a troca', url: groupMessageLink(ctx.message.chat.id, groupMessageId) }],
        })
      }

      const [proposerOfferText, targetOfferText] = await Promise.all([
        formatOffer(finalState.offers.proposer),
        formatOffer(finalState.offers.target),
      ])

      const finalizeImage = await renderTradeImage(finalState, proposerAvatarUrl, proposerName, targetAvatarUrl, targetName)

      const doneFlags: Record<Side, boolean> = { proposer: false, target: false }
      const finalizeContent = (waitingLine: string) =>
        `💱 Troca entre ${mention(ctx.message.author.id, proposerName)} e ${mention(targetTelegramId, targetName)}\n\n🃏 **${escapeMarkdown(proposerName)}** está oferecendo:\n\n${proposerOfferText}\n\n🃏 **${escapeMarkdown(targetName)}** está oferecendo:\n\n${targetOfferText}\n\nCliquem em ✅ Finalizar troca para finalizar a troca, ou ❌ Cancelar para cancelar a troca.\nAtenção: a troca será desfeita caso um dos usuários clique em cancelar. Preste atenção!\n\n${waitingLine}`

      const finalizeResult = await awaitMultiPartyChoice<'finalize' | 'cancel'>(
        ctx,
        FINALIZE_EVENT,
        {
          content: finalizeContent('⌛ Aguardando usuários.'),
          photoUrl: finalizeImage.url,
          editMessageId: groupMessageId,
        },
        [{ title: '✅ Finalizar troca', data: 'finalize' }, { title: '❌ Cancelar', data: 'cancel' }],
        [ctx.message.author.id, targetTelegramId],
        (c) => {
          if (c.data === 'cancel') return true
          doneFlags[sideOf(c.clickerUserId)] = true
          return doneFlags.proposer && doneFlags.target
        },
        INACTIVITY_TIMEOUT_SECONDS,
        async (_choice, buttons) => {
          const pendingSide: Side = doneFlags.proposer ? 'target' : 'proposer'
          await reply(ctx, {
            content: finalizeContent(`⌛ Aguardando ${mention(telegramIdOf(pendingSide), nameOf(pendingSide))}.`),
            photoUrl: finalizeImage.url,
            editMessageId: groupMessageId,
            captionOnly: true,
            buttonRows: buttons,
          })
        },
      )

      if (!finalizeResult || finalizeResult.data === 'cancel') {
        await deleteMsg(ctx, groupMessageId)
        await reply(ctx, finalizeResult
          ? `😬 Vish... ${mention(ctx.message.author.id, proposerName)} e ${mention(targetTelegramId, targetName)} cancelaram a troca de última hora. Brigaram?`
          : 'A troca expirou por inatividade. 😴')
        return
      }

      const offerAEntries = Object.entries(finalState.offers.proposer).map(([cardId, count]) => ({ cardId: Number(cardId), count }))
      const offerBEntries = Object.entries(finalState.offers.target).map(([cardId, count]) => ({ cardId: Number(cardId), count }))

      try {
        await CardsDB.executeTrade(proposerUser.id, offerAEntries, targetUser.id, offerBEntries)
      } catch (e) {
        await deleteMsg(ctx, groupMessageId)
        if (e instanceof InsufficientCardError) {
          const who = e.userId === proposerUser.id ? proposerName : targetName
          await reply(ctx, `Não foi possível completar a troca: **${escapeMarkdown(who)}** não tem mais uma das cartas oferecidas.`)
        } else {
          await reply(ctx, `Não foi possível completar a troca: ${(e as Error).message}`)
        }
        return
      }

      await deleteMsg(ctx, groupMessageId)

      const image = await renderTradeImage(finalState, proposerAvatarUrl, proposerName, targetAvatarUrl, targetName)

      await reply(ctx, {
        content: `💱 Troca entre ${mention(ctx.message.author.id, proposerName)} e ${mention(targetTelegramId, targetName)} FINALIZADA! ✅\n\n🃏 **${escapeMarkdown(proposerName)}** ofereceu:\n\n${proposerOfferText}\n\n🃏 **${escapeMarkdown(targetName)}** ofereceu:\n\n${targetOfferText}`,
        photoUrl: image.url,
      })
    } finally {
      await rawClient.del(lockKey(ctx.message.author.id))
      await rawClient.del(lockKey(targetTelegramId))
      await rawClient.del(stateKey(ctx.workflowIDToBeAssigned))
    }
  }

  @QuickView({ name: 'tradeCard' })
  static async tradeCard(arg: string, clickerUserId: string): Promise<string> {
    const sep = arg.indexOf(':')
    const action = arg.slice(0, sep)
    const cardId = parseInt(arg.slice(sep + 1), 10)
    if ((action !== 'add' && action !== 'remove') || isNaN(cardId)) return 'Erro ao processar.'
    return modifyTradeOffer(clickerUserId, cardId, action)
  }

  @QuickView({ name: 'tradeReady' })
  static async tradeReady(_arg: string, clickerUserId: string): Promise<string> {
    const active = await getActiveTradeSide(clickerUserId)
    if (!active) return 'Você não está em uma troca de cartas...'
    const { workflowID, state, side } = active
    if (Object.keys(state.offers[side]).length === 0) return 'Você não adicionou nenhuma carta...'

    state.ready[side] = true
    await saveState(workflowID, state)
    await DBOS.send<NegotiationEvent>(workflowID, { type: 'stateChanged', clickerUserId }, NEGOTIATION_TOPIC)
    return 'Certo! Agora, aguarde o outro usuário ficar pronto.'
  }
}
