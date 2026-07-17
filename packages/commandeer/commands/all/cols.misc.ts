import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { getBotUsername } from '../../services/botInfo'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class ColsLinkCommand extends Command {
  static override info = {
    name: 'cols',
    description: 'Envia o link para ver seu progresso de coleções no mini app',
    usage: '/cols',
    aliases: ['progresso', 'progress'],
  }

  static override async execute(ctx: IncomingCommand) {
    const botUsername = await getBotUsername()
    await reply(ctx, `[Veja seu progresso aqui](https://t.me/${botUsername}/cols)`)
  }
}
