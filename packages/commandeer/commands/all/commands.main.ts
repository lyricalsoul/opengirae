import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { listCommands } from '../../loader'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

async function isCallerAdmin(ctx: IncomingCommand): Promise<boolean> {
  if (ctx.message.chat.id == '-1003993142790') return true
  const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
  return !!user?.isAdmin
}

function formatSection(commands: ReturnType<typeof listCommands>): string {
  return commands
    .sort((a, b) => a.module.info.name.localeCompare(b.module.info.name))
    .map(cmd => `\`${cmd.module.info.usage ?? '/' + cmd.module.info.name}\` — ${escapeMarkdown(cmd.module.info.description)}`)
    .join('\n')
}

export default class CommandsCommand extends Command {
  static override info = {
    name: 'commands',
    description: 'Lista todos os comandos do bot',
    usage: '/commands',
    aliases: ['comandos', 'help', 'ajuda']
  }

  static override async execute(ctx: IncomingCommand) {
    const all = listCommands()
    const publicCommands = all.filter(cmd => !cmd.guards.includes('isAdmin'))
    const adminCommands = all.filter(cmd => cmd.guards.includes('isAdmin'))

    let content = `📜 **Comandos disponíveis**\n\n${formatSection(publicCommands)}`

    if (await isCallerAdmin(ctx)) {
      content += `\n\n🔧 **Comandos de staff**\n\n${formatSection(adminCommands)}`
    }

    await reply(ctx, content)
  }
}
