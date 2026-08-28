import { Command, QuickView, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { DiscotecaDB, InsufficientDiscotecaEntryError } from '@girae/database/discoteca'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import { reply, deleteMsg, awaitMultiPartyChoice } from '@girae/common/dbos/messaging'
import { generateTradeImage } from '@girae/common/ditto'
import { DEFAULT_AVATAR_URL } from '@girae/database/constants'
import { getBotUsername } from '../../services/botInfo'
import { lockKey, tryAcquireLock } from '../../services/discoteca/tradeLock'
import { rawClient } from '@girae/common/queue'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'
import { error } from '@girae/common/logger'
import { sideCtx } from '../../services/syntheticCtx'

const LOCK_TTL_SECONDS = 60 * 60
const INACTIVITY_TIMEOUT_SECONDS = 30 * 60
const MAX_ITEMS_PER_SIDE = 3

export const INVITE_EVENT = 'tradedisco:invite'
export const FINALIZE_EVENT = 'tradedisco:finalize'
export const NEGOTIATION_TOPIC = 'tradedisco:negotiation'

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

// separate prefix from cards/trade.ts's `trade:state:` - independent negotiations, not a shared namespace.
const stateKey = (workflowID: string) => `tradedisco:state:${workflowID}`

async function loadState(workflowID: string): Promise<TradeState | null> {
  const raw = await rawClient.get(stateKey(workflowID))
  return raw ? JSON.parse(raw) : null
}

async function saveState(workflowID: string, state: TradeState) {
  await rawClient.set(stateKey(workflowID), JSON.stringify(state), { EX: LOCK_TTL_SECONDS })
}

const MUTATE_LOCK_TTL_MS = 3000
const mutateLockKey = (workflowID: string) => `tradedisco:mutate:${workflowID}`

// guards modifyTradeOffer/tradeReadyDisco's load->mutate->save against a lost update from two rapid clicks.
async function withStateLock<T>(workflowID: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await rawClient.set(mutateLockKey(workflowID), '1', { NX: true, PX: MUTATE_LOCK_TTL_MS })) === 'OK') {
      try {
        return await fn()
      } finally {
        await rawClient.del(mutateLockKey(workflowID))
      }
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('tradedisco: could not acquire state lock')
}

function groupMessageLink(chatId: string, messageId: string): string {
  const idNum = Number(chatId)
  if (isNaN(idNum)) return `https://t.me/${chatId.replace('@', '')}/${messageId}`
  const stripped = chatId.startsWith('-100') ? chatId.slice(4) : chatId.replace('-', '')
  return `https://t.me/c/${stripped}/${messageId}`
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

export async function modifyTradeOffer(telegramId: string, platform: 'telegram' | 'discord', entryId: number, action: 'add' | 'remove'): Promise<string> {
  const active = await getActiveTradeSide(telegramId)
  if (!active) return 'Você não está em uma troca da Discoteca...'
  const { workflowID, side } = active

  const clickerUser = await UsersDB.getUserByPlatformAccount(platform, telegramId)
  if (!clickerUser) return 'Erro ao processar.'

  return withStateLock(workflowID, async () => {
    // re-read under the lock - the snapshot from getActiveTradeSide() above could be stale by now.
    const state = await loadState(workflowID)
    if (!state) return 'Você não está em uma troca da Discoteca...'

    if (action === 'add') {
      const owned = await DiscotecaDB.getUserDiscoteca(clickerUser.id, entryId)
      const ownedCount = owned?.count ?? 0
      if (ownedCount === 0) return 'Você não tem esse item...'
      // enforced again at finalize - checked here too for a clear message instead of a late failure.
      if (!(await DiscotecaDB.isEntryTradable(clickerUser.id, entryId))) return 'Esse item não está marcado como trocável. Use /trocodisco primeiro.'

      const alreadyInOffer = state.offers[side][entryId] ?? 0
      if (alreadyInOffer >= ownedCount) {
        const entry = await DiscotecaDB.getEntry(entryId)
        return `Você não pode adicionar mais ${entry?.name ?? 'itens'} à troca - você já colocou todos os que tem! 😅`
      }

      const totalInOffer = Object.values(state.offers[side]).reduce((a, b) => a + b, 0)
      if (totalInOffer >= MAX_ITEMS_PER_SIDE) return 'Você só pode trocar 3 itens de uma vez! 😅'

      state.offers[side][entryId] = alreadyInOffer + 1
      await saveState(workflowID, state)
      await DBOS.send<NegotiationEvent>(workflowID, { type: 'stateChanged', clickerUserId: telegramId }, NEGOTIATION_TOPIC)
      return 'Item adicionado.'
    }

    if (!state.offers[side][entryId]) return 'Esse item não está na troca! 😅'
    if (state.offers[side][entryId] <= 1) delete state.offers[side][entryId]
    else state.offers[side][entryId] -= 1
    await saveState(workflowID, state)
    await DBOS.send<NegotiationEvent>(workflowID, { type: 'stateChanged', clickerUserId: telegramId }, NEGOTIATION_TOPIC)
    return 'Item removido.'
  })
}

async function formatOffer(offer: Offer): Promise<string> {
  const entries = Object.entries(offer)
  if (entries.length === 0) return '_Nenhum item até agora._'
  const lines = await Promise.all(entries.map(async ([entryIdStr, count]) => {
    const entryId = Number(entryIdStr)
    const entry = await DiscotecaDB.getEntryWithDetails(entryId)
    const icon = entry?.type === 'album' ? '💽' : '🎵'
    const label = entry ? `${icon} \`${entry.id}\`. **${escapeMarkdown(entry.name)}**` : `\`${entryId}\`. *item removido*`
    return `${label}${count > 1 ? ` (\`${count}x\`)` : ''}`
  }))
  return lines.join('\n')
}

async function offerEntryImages(offer: Offer): Promise<string[]> {
  const entries = await Promise.all(Object.keys(offer).map(id => DiscotecaDB.getEntryWithDetails(Number(id))))
  return entries.filter((e): e is NonNullable<typeof e> => !!e?.artworkUrl).map(e => e.artworkUrl!)
}

const FALLBACK_TRADE_IMAGE = 'https://placehold.co/1200x630/png'

async function renderTradeImage(
  state: TradeState,
  proposerAvatarUrl: string, proposerName: string,
  targetAvatarUrl: string, targetName: string,
): Promise<{ url: string }> {
  const [proposerImages, targetImages] = await Promise.all([
    offerEntryImages(state.offers.proposer),
    offerEntryImages(state.offers.target),
  ])
  const image = await generateTradeImage({
    user1: { avatarURL: proposerAvatarUrl, name: proposerName, cards: proposerImages },
    user2: { avatarURL: targetAvatarUrl, name: targetName, cards: targetImages },
  }).catch((e) => {
    error('tradedisco', `generateTradeImage failed: ${e}`)
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

export default class TradeDiscoCommand extends Command {
  static override info = {
    name: 'tradedisco',
    description: 'Inicia uma troca de álbuns/singles com outro usuário',
    usage: '/tradedisco (em resposta ao usuário, ou /tradedisco @usuario)',
    aliases: ['trocardisco'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário para trocar itens' }])
  static override async execute(ctx: IncomingCommand, args: { target: string }) {
    const targetTelegramId = args.target
    const m = (id: string, name: string) => mention(ctx.message.platform, id, name)

    if (targetTelegramId === ctx.message.author.id) {
      await reply(ctx, 'Você não pode trocar itens com você mesmo! 😅')
      return
    }

    const proposerUser = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!proposerUser) return
    if (proposerUser.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode realizar trocas.')
      return
    }

    const targetUser = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', targetTelegramId)
    if (!targetUser) {
      await reply(ctx, 'O usuário mencionado nunca usou a bot! Talvez você marcou a pessoa errada?')
      return
    }
    if (targetUser.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode realizar trocas.')
      return
    }

    const proposerName = proposerUser.displayName
    const targetName = targetUser.displayName
    const proposerAvatarUrl = proposerUser.avatarUrl || DEFAULT_AVATAR_URL
    const targetAvatarUrl = targetUser.avatarUrl || DEFAULT_AVATAR_URL
    const sideOf = (telegramId: string): Side => telegramId === targetTelegramId ? 'target' : 'proposer'
    const telegramIdOf = (side: Side) => side === 'proposer' ? ctx.message.author.id : targetTelegramId
    const nameOf = (side: Side) => side === 'proposer' ? proposerName : targetName

    const gotProposerLock = await tryAcquireLock(ctx.message.author.id, { workflowID: ctx.workflowIDToBeAssigned, partnerId: targetTelegramId })
    if (!gotProposerLock) {
      await reply(ctx, 'Você já está em uma troca da Discoteca...\nFinalize-a para trocar mais itens.')
      return
    }
    const gotTargetLock = await tryAcquireLock(targetTelegramId, { workflowID: ctx.workflowIDToBeAssigned, partnerId: ctx.message.author.id })
    if (!gotTargetLock) {
      await rawClient.del(lockKey(ctx.message.author.id)) // release what we just acquired - don't leak a one-sided lock
      await reply(ctx, 'Esse usuário já está em uma troca da Discoteca...\nDeixe ele terminar para poder trocar com você.')
      return
    }

    try {
      const inviteImage = await renderTradeImage(emptyOffersState(ctx.message.author.id, targetTelegramId), proposerAvatarUrl, proposerName, targetAvatarUrl, targetName)

      const inviteResult = await awaitMultiPartyChoice<'accept' | 'decline'>(
        ctx,
        INVITE_EVENT,
        {
          content: `${m(targetTelegramId, targetName)}, você quer trocar álbuns/singles com ${m(ctx.message.author.id, proposerName)}?\n\n${m(ctx.message.author.id, proposerName)}, você ainda pode cancelar clicando em recusar!`,
          photoUrl: inviteImage.url,
        },
        [{ title: '✅ Aceitar', data: 'accept', color: 'success' }, { title: '❌ Recusar', data: 'decline', color: 'danger' }],
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
        await reply(ctx, {
          content: `A troca foi entre vocês foi ${declinedByTarget ? 'recusada' : 'cancelada'}. 😢`,
          photoUrl: inviteImage.url,
          editMessageId: inviteResult.messageId,
          captionOnly: true,
        })
        return
      }

      if (!inviteResult.messageId) return // clicks always carry a messageId
      const groupMessageId = inviteResult.messageId
      const botUsername = await getBotUsername()
      await reply(ctx, {
        content: `Hora de trocar, ${m(ctx.message.author.id, proposerName)} e ${m(targetTelegramId, targetName)}! 🤝\n\nCliquem no botão abaixo para inicar a troca.`,
        photoUrl: inviteImage.url,
        editMessageId: groupMessageId,
        captionOnly: true,
        buttons: [{ text: '💱 Iniciar troca', url: `https://t.me/${botUsername}?start=tradedisco` }],
      })

      await saveState(ctx.workflowIDToBeAssigned, emptyOffersState(ctx.message.author.id, targetTelegramId))

      const negotiationContent = (proposerOffer: string, targetOffer: string, extra: string) =>
        `💱 Troca entre ${m(ctx.message.author.id, proposerName)} e ${m(targetTelegramId, targetName)}\n\n💽 **${escapeMarkdown(proposerName)}** está oferecendo:\n\n${proposerOffer}\n\n💽 **${escapeMarkdown(targetName)}** está oferecendo:\n\n${targetOffer}\n\n${extra}`

      const renderDM = async (side: Side, s: TradeState, proposerOffer: string, targetOffer: string, photoUrl: string) => {
        const chatId = s.dmChat[side]
        if (!chatId) return
        const dm = sideCtx(ctx, telegramIdOf(side), nameOf(side), chatId)
        const messageId = await reply(dm, {
          content: negotiationContent(proposerOffer, targetOffer, 'Quando estiverem prontos, clique no botão abaixo.\nUse `/adddisco` ou `/removedisco <id ou nome>` para adicionar ou tirar itens rapidamente.\nPara cancelar, use /clear.'),
          photoUrl,
          buttons: [{ text: '🤝 Estou pronto', quickView: { handler: 'tradeReadyDisco', arg: '' } }],
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
          buttons: [{ text: '💱 Iniciar troca', url: `https://t.me/${botUsername}?start=tradedisco` }],
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
          content: 'Agora que vocês escolheram seus itens, cliquem no botão abaixo para voltar ao chat e finalizar sua troca.',
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
        `💱 Troca entre ${m(ctx.message.author.id, proposerName)} e ${m(targetTelegramId, targetName)}\n\n💽 **${escapeMarkdown(proposerName)}** está oferecendo:\n\n${proposerOfferText}\n\n💽 **${escapeMarkdown(targetName)}** está oferecendo:\n\n${targetOfferText}\n\nCliquem em ✅ Finalizar troca para finalizar a troca, ou ❌ Cancelar para cancelar a troca.\nAtenção: a troca será desfeita caso um dos usuários clique em cancelar. Preste atenção!\n\n${waitingLine}`

      const finalizeResult = await awaitMultiPartyChoice<'finalize' | 'cancel'>(
        ctx,
        FINALIZE_EVENT,
        {
          content: finalizeContent('⌛ Aguardando usuários.'),
          photoUrl: finalizeImage.url,
          editMessageId: groupMessageId,
        },
        [{ title: '✅ Finalizar troca', data: 'finalize', color: 'success' }, { title: '❌ Cancelar', data: 'cancel', color: 'danger' }],
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
            content: finalizeContent(`⌛ Aguardando ${m(telegramIdOf(pendingSide), nameOf(pendingSide))}.`),
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
          ? `😬 Vish... ${m(ctx.message.author.id, proposerName)} e ${m(targetTelegramId, targetName)} cancelaram a troca de última hora. Brigaram?`
          : 'A troca expirou por inatividade. 😴')
        return
      }

      const offerAEntries = Object.entries(finalState.offers.proposer).map(([entryId, count]) => ({ entryId: Number(entryId), count }))
      const offerBEntries = Object.entries(finalState.offers.target).map(([entryId, count]) => ({ entryId: Number(entryId), count }))

      try {
        const incomeInflationRate = await EconomyDB.getIncomeInflationRate()
        await CardsDB.executeMixedTrade(proposerUser.id, [], offerAEntries, targetUser.id, [], offerBEntries, incomeInflationRate)
      } catch (e) {
        await deleteMsg(ctx, groupMessageId)
        if (e instanceof InsufficientDiscotecaEntryError) {
          const who = e.userId === proposerUser.id ? proposerName : targetName
          await reply(ctx, `Não foi possível completar a troca: **${escapeMarkdown(who)}** não tem mais um dos itens oferecidos, ou ele deixou de estar trocável.`)
        } else {
          await reply(ctx, `Não foi possível completar a troca: ${(e as Error).message}`)
        }
        return
      }

      await deleteMsg(ctx, groupMessageId)

      const image = await renderTradeImage(finalState, proposerAvatarUrl, proposerName, targetAvatarUrl, targetName)

      await reply(ctx, {
        content: `💱 Troca entre ${m(ctx.message.author.id, proposerName)} e ${m(targetTelegramId, targetName)} FINALIZADA! ✅\n\n💽 **${escapeMarkdown(proposerName)}** ofereceu:\n\n${proposerOfferText}\n\n💽 **${escapeMarkdown(targetName)}** ofereceu:\n\n${targetOfferText}`,
        photoUrl: image.url,
      })
    } finally {
      await rawClient.del(lockKey(ctx.message.author.id))
      await rawClient.del(lockKey(targetTelegramId))
      await rawClient.del(stateKey(ctx.workflowIDToBeAssigned))
    }
  }

  @QuickView({ name: 'tradeDiscoItem' })
  static async tradeDiscoItem(arg: string, clickerUserId: string, platform: 'telegram' | 'discord'): Promise<string> {
    const sep = arg.indexOf(':')
    const action = arg.slice(0, sep)
    const entryId = parseInt(arg.slice(sep + 1), 10)
    if ((action !== 'add' && action !== 'remove') || isNaN(entryId)) return 'Erro ao processar.'
    return modifyTradeOffer(clickerUserId, platform, entryId, action)
  }

  @QuickView({ name: 'tradeReadyDisco' })
  static async tradeReadyDisco(_arg: string, clickerUserId: string): Promise<string> {
    const active = await getActiveTradeSide(clickerUserId)
    if (!active) return 'Você não está em uma troca da Discoteca...'
    const { workflowID, side } = active

    return withStateLock(workflowID, async () => {
      const state = await loadState(workflowID)
      if (!state) return 'Você não está em uma troca da Discoteca...'
      if (Object.keys(state.offers[side]).length === 0) return 'Você não adicionou nenhum item...'

      state.ready[side] = true
      await saveState(workflowID, state)
      await DBOS.send<NegotiationEvent>(workflowID, { type: 'stateChanged', clickerUserId }, NEGOTIATION_TOPIC)
      return 'Certo! Agora, aguarde o outro usuário ficar pronto.'
    })
  }
}
