import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { getBotUsername } from '../../services/botInfo'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class InventoryLinkCommand extends Command {
  static override info = {
    name: 'inv',
    description: 'Envia o link para ver seu inventário no mini app',
    usage: '/inv',
    aliases: ['inventario', 'inventory'],
  }

  static override async execute(ctx: IncomingCommand) {
    const botUsername = await getBotUsername()
    await reply(ctx, `[Veja seu inventario aqui](https://t.me/${botUsername}/inventory)`)
  }
}
