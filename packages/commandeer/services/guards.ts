import { UsersDB } from "@girae/database/users"
import { reply } from "@girae/common/dbos/messaging"
import type { IncomingCommand } from "@girae/common/commands/types"

type Guard = (cmd: IncomingCommand) => Promise<boolean>

export const guards: Record<string, Guard> = {
  isAdmin: async (cmd) => {
    if (cmd.message.chat.id == '-1003993142790') return true

    const user = await UsersDB.getUserByPlatformAccount(cmd.message.platform as 'telegram' | 'discord', cmd.message.author.id)
    if (!user?.isAdmin) {
      return false
    }
    return true
  }
}

export async function passesGuards(guardNames: string[], cmd: IncomingCommand): Promise<boolean> {
  for (const name of guardNames) {
    const guard = guards[name]
    if (!guard) continue
    if (!(await guard(cmd))) return false
  }
  return true
}
