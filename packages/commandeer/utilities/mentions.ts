import type { IncomingCommand } from "@girae/common/commands/types"

export async function resolveTargetTelegramId(cmd: IncomingCommand): Promise<string> {
  if (cmd.message.replyTo) return cmd.message.replyTo.author.id

  const arg = cmd.args[0]
  if (arg && /^\d+$/.test(arg)) return arg

  return cmd.message.author.id
}
