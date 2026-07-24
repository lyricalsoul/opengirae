import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class ReceitaCommand extends Command {
  static override info = {
    name: 'receita',
    description: 'Mostra o total do tesouro da Giraê e quanto você já contribuiu',
    usage: '/receita',
    aliases: ['receitafederal', 'treasury'],
  }

  static override async execute(ctx: IncomingCommand) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const state = await EconomyDB.getState()
    const formatter = new Intl.NumberFormat('pt-BR')

    const text = `🦁 Receita Federal da Giraê

💰 Total arrecadado: **${formatter.format(state.treasuryBalance)}** moedas
🧾 Você contribuiu com **${formatter.format(user.treasuryContributed)}** moedas`

    await reply(ctx, text)
  }
}
