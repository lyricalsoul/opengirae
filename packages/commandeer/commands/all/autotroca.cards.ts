import { Command, QuickView } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import type { IncomingCommand } from '@girae/common/commands/types'
import { AUTOTROCA_BULK_QUICKVIEW, autotrocaContent, autotrocaBulkButton } from '../../services/autotroca'

export default class AutotrocaCommand extends Command {
  static override info = {
    name: 'autotroca',
    description: 'Alterna se cards novos são trocáveis por padrão',
    usage: '/autotroca',
  }

  static override async execute(ctx: IncomingCommand) {
    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const enabled = !user.makeCardsTradeableByDefault
    await UsersDB.setMakeCardsTradeableByDefault(user.id, enabled)
    await reply(ctx, {
      content: autotrocaContent(enabled),
      buttons: [autotrocaBulkButton(enabled)],
    })
  }

  @QuickView({ name: AUTOTROCA_BULK_QUICKVIEW })
  static async applyToExistingCards(arg: string, clickerUserId: string): Promise<string> {
    const tradable = arg === 'true'
    const user = await UsersDB.getUserByTelegramId(clickerUserId)
    if (!user) return 'Erro ao atualizar seus cards.'

    const count = await CardsDB.setAllUserCardsTradable(user.id, tradable)
    return tradable
      ? `✅ ${count} card${count === 1 ? '' : 's'} marcado${count === 1 ? '' : 's'} como trocável.`
      : `✅ ${count} card${count === 1 ? '' : 's'} marcado${count === 1 ? '' : 's'} como não trocável.`
  }
}
