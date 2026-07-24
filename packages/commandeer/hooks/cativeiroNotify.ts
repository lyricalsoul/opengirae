import { Hook } from '@girae/common/hooks'
import type { CardsNewEvent } from '@girae/common/hooks/types'
import { CardsDB } from '@girae/database/cards'
import { reply } from '@girae/common/dbos/messaging'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { buildCtx } from '../services/syntheticCtx'

export default class CativeiroNotifyHook {
  // Best-effort private DM: Telegram (and likely Discord) refuse a bot-initiated DM to
  // someone who's never opened a chat with the bot, and reply() fails silently in that
  // case - there's deliberately no group-chat fallback here, since the alert is meant to
  // be private; /cativeiros remains the reliable way to discover eligibility regardless.
  @Hook('cards:new')
  static async onCardsNew(event: CardsNewEvent) {
    const card = await CardsDB.getCardWithDetails(event.cardId)
    if (!card) return
    if (event.previousCount >= card.cativeiroThreshold || event.newCount < card.cativeiroThreshold) return

    const subEmoji = card.subcategoryEmoji ? `${card.subcategoryEmoji} ` : ''
    const dm = buildCtx(event.platform, event.telegramId, event.displayName, event.telegramId)
    await reply(dm, `🎉 Parabéns! Você agora tem **${card.cativeiroThreshold}x** ${subEmoji}${card.rarityEmoji} \`${event.cardId}\`. **${escapeMarkdown(card.name)}** e já pode personalizar esse card com um vídeo/foto e emoji de sua preferência!\n\nPara mais informações, use /cativeiros 💖`)
  }
}
