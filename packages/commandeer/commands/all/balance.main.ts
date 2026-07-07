import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class BalanceCommand extends Command {
  static override info = {
    name: 'balance',
    description: 'Mostra seu saldo de moedas e quantidade de cartas',
    aliases: ['balanço', 'atm', 'balanco']
  }

  static override async execute(ctx: IncomingCommand) {
    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) {
      return
    }

    const cardsCount = await CardsDB.getUserCardsCount(user.id)
    const formatter = new Intl.NumberFormat('pt-BR')

    const text = `🏧 Finanças de **${ctx.message.author.name}**

💴 **Moedas**: \`${formatter.format(user.coins)}\`
🃏 **Cartas**: \`${formatter.format(cardsCount)}\``

    await reply(ctx, text)
  }
}
