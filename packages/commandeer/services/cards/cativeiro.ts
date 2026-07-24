import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

export async function cativeiroEligibilityGuard(card: CardDetails, ctx: IncomingCommand): Promise<boolean | string> {
  const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
  if (!user) return false

  const owned = await CardsDB.getUserCard(user.id, card.id)
  if (!owned || owned.count < card.cativeiroThreshold) {
    return 'Esse card não está elegível para cativeiro ainda. Use /cativeiros para ver quais estão liberados. 😅'
  }
  return true
}

// ZWJ + variation selector-16 let multi-codepoint emoji (families, flags, skin tones) through too.
const EMOJI_ONLY_REGEX = /^[\p{Extended_Pictographic}‍️]+$/u

export function isEmojiOnly(str: string): boolean {
  return EMOJI_ONLY_REGEX.test(str.trim())
}

// /u is required: 🥇🥈🥉 share a UTF-16 high surrogate with unrelated emoji (e.g. 🪵).
const RARITY_EMOJI_REGEX = /[🥉🥈🥇]/u

export function containsRarityEmoji(str: string): boolean {
  return RARITY_EMOJI_REGEX.test(str)
}

export function validateCustomEmoji(value: string): boolean | string {
  if (!isEmojiOnly(value)) return 'Manda um emoji de verdade pra mim personalizar seu card! 🥺'
  if (containsRarityEmoji(value)) return 'Esse emoji já é usado pela bot para mostrar a raridade das cartas. Escolha outro! 😅'
  return true
}
