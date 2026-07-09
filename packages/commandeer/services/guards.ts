import { UsersDB } from "@girae/database/users"
import { reply } from "@girae/common/dbos/messaging"
import type { IncomingCommand } from "@girae/common/commands/types"

type Guard = (cmd: IncomingCommand) => Promise<boolean>

export const guards: Record<string, Guard> = {
  isAdmin: async (cmd) => {
    const user = await UsersDB.getUserByTelegramId(cmd.message.author.id)
    if (!user?.isAdmin) {
      await reply(cmd, 'Este comando é restrito a administradores. 🚫')
      return false
    }
    return true
  }
}

// ponytail: unregistered guard names (e.g. "all") are no-ops so existing command folders don't break
export async function passesGuards(guardNames: string[], cmd: IncomingCommand): Promise<boolean> {
  for (const name of guardNames) {
    const guard = guards[name]
    if (!guard) continue
    if (!(await guard(cmd))) return false
  }
  return true
}
