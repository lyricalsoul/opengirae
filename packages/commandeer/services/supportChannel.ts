import { UsersDB } from "@girae/database/users"
import { tg } from "./botInfo"
import { error } from "@girae/common/logger"

const SUPPORT_CHANNEL = '@undergirae'
const CHECK_TTL_MS = 60 * 60 * 1000

const JOINED_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted'])

export async function hasJoinedSupportChannel(user: { id: number; hasJoinedSupportChannel: boolean; supportChannelCheckedAt: Date | null }, telegramId: string): Promise<boolean> {
  const isFresh = user.supportChannelCheckedAt && Date.now() - user.supportChannelCheckedAt.getTime() < CHECK_TTL_MS
  if (isFresh) return user.hasJoinedSupportChannel

  let joined: boolean
  try {
    const member = await tg.getChatMember(SUPPORT_CHANNEL, telegramId)
    joined = JOINED_STATUSES.has(member.status)
  } catch (e) {
    error('commandeer', `Failed to check support channel membership for ${telegramId}: ${e}`)
    joined = false
  }

  await UsersDB.setSupportChannelJoined(user.id, joined)
  return joined
}
