import { UsersDB } from '@girae/database/users'
import { reply, type ButtonSpec } from '@girae/common/dbos/messaging'
import { buildCtx } from '../syntheticCtx'
import type { Platform } from '@girae/common/commands/types'

// a user can be linked on both platforms - DM whichever one they're actually reachable on, telegram first. false when they have no linked account to message.
export async function dmUser(userId: number, displayName: string, content: string, buttons?: ButtonSpec[]): Promise<boolean> {
  for (const platform of ['telegram', 'discord'] as Platform[]) {
    const platformId = await UsersDB.getPlatformIdForUser(userId, platform)
    if (!platformId) continue
    await reply(buildCtx(platform, platformId, displayName, platformId), buttons ? { content, buttons } : content)
    return true
  }
  return false
}
