import { reply } from "@girae/common/dbos/messaging"
import { getUserByPlatformAccountCached } from "@girae/common/cache/users"
import type { IncomingCommand } from "@girae/common/commands/types"

type Guard = (cmd: IncomingCommand) => Promise<boolean>

const STAFF_GROUP_CHAT_ID = '-1004377125716'

export const guards: Record<string, Guard> = {
  isAdmin: async (cmd) => {
    if (cmd.message.chat.id == STAFF_GROUP_CHAT_ID) return true

    const user = await getUserByPlatformAccountCached(cmd.message.platform as 'telegram' | 'discord', cmd.message.author.id)
    if (!user?.isAdmin) {
      return false
    }
    return true
  },
  isSpecial: async (cmd) => {
    const user = await getUserByPlatformAccountCached(cmd.message.platform as 'telegram' | 'discord', cmd.message.author.id)
    return !!user?.specialUser
  },
  // unlike isAdmin, ignores the isAdmin flag entirely - only the physical staff chat passes.
  staffGroupOnly: async (cmd) => cmd.message.chat.id == STAFF_GROUP_CHAT_ID,
}

export async function passesGuards(guardNames: string[], cmd: IncomingCommand): Promise<boolean> {
  for (const name of guardNames) {
    const guard = guards[name]
    if (!guard) continue
    if (!(await guard(cmd))) return false
  }
  return true
}
