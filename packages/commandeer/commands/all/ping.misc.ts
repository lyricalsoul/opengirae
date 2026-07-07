import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class PingCommand extends Command {
  static override info = {
    name: 'ping',
    description: 'Verifica se o bot está online',
    aliases: ['pong']
  }

  static override async execute(cmd: IncomingCommand) {
    await reply(cmd, 'Pong!')
  }
}
