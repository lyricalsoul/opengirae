import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

// shared @CommandArgument guard for /upload and /emojicard's `card` spec - both require
// the caller to actually own enough copies of that specific card to have unlocked cativeiro.
export async function cativeiroEligibilityGuard(card: CardDetails, ctx: IncomingCommand): Promise<boolean | string> {
  const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
  if (!user) return false

  const owned = await CardsDB.getUserCard(user.id, card.id)
  if (!owned || owned.count < card.cativeiroThreshold) {
    return 'Esse card não está elegível para cativeiro ainda. Use /cativeiros para ver quais estão liberados. 😅'
  }
  return true
}

// Extended_Pictographic covers standalone emoji; ‍ (ZWJ) and ️ (variation
// selector-16) let multi-codepoint emoji (families, flags, skin tones) through too.
const EMOJI_ONLY_REGEX = /^[\p{Extended_Pictographic}‍️]+$/u

export function isEmojiOnly(str: string): boolean {
  return EMOJI_ONLY_REGEX.test(str.trim())
}

// The bot's own rarity markers - a customized card must never be confused with a real
// rarity, regardless of which rarity the card actually is.
// The /u flag is required here: 🥇🥈🥉 and plenty of unrelated emoji (e.g. 🪵) share the
// same UTF-16 high surrogate, so without /u a character class matches on individual
// surrogate halves instead of full codepoints and flags emoji that were never intended.
const RARITY_EMOJI_REGEX = /[🥉🥈🥇]/u

export function containsRarityEmoji(str: string): boolean {
  return RARITY_EMOJI_REGEX.test(str)
}

// @CommandArgument guard for /emojicard's `emoji` spec.
export function validateCustomEmoji(value: string): boolean | string {
  if (!isEmojiOnly(value)) return 'Manda um emoji de verdade pra mim personalizar seu card! 🥺'
  if (containsRarityEmoji(value)) return 'Esse emoji já é usado pela bot para mostrar a raridade das cartas. Escolha outro! 😅'
  return true
}
