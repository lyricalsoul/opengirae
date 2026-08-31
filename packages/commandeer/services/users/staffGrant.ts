import { UsersDB } from '@girae/database/users'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'

// shared by /dar and /tirar to resolve both the staff member and the target user.
export async function resolveStaffAndTarget(ctx: IncomingCommand, targetPlatformId: string) {
  const platform = ctx.message.platform as 'telegram' | 'discord'

  const staff = await UsersDB.getUserByPlatformAccount(platform, ctx.message.author.id)
  if (!staff) return null

  const target = await UsersDB.getUserByPlatformAccount(platform, targetPlatformId)
  if (!target) {
    await reply(ctx, 'Não encontrei esse usuário. Ele já usou a bot?')
    return null
  }

  return { staff, target }
}
