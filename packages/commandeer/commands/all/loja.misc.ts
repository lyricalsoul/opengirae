import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { getBotUsername } from '../../services/botInfo'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class LojaLinkCommand extends Command {
  static override info = {
    name: 'loja',
    description: 'Envia o link para ver a loja no mini app',
    usage: '/loja',
  }

  static override async execute(ctx: IncomingCommand) {
    const botUsername = await getBotUsername()
    await reply(ctx, `[Veja a loja da Girae aqui](https://t.me/${botUsername}/store)`)
  }
}
