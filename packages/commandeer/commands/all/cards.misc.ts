import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { getBotUsername } from '../../services/botInfo'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class CardsLinkCommand extends Command {
  static override info = {
    name: 'cards',
    description: 'Envia o link para ver seus cards no mini app',
    usage: '/cards',
  }

  static override async execute(ctx: IncomingCommand) {
    const botUsername = await getBotUsername()
    await reply(ctx, `[Veja seus cards aqui](https://t.me/${botUsername}/cards)`)
  }
}
