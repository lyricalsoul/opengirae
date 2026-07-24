import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import type { IncomingCommand } from '@girae/common/commands/types'

function getTimeUntilMidnight(): string {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(3, 0, 0, 0);

  if (now.getUTCHours() >= 3) {
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  }

  const diffMs = nextMidnight.getTime() - now.getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  return `${diffHrs} hora${diffHrs === 1 ? '' : 's'} e ${diffMins} minuto${diffMins === 1 ? '' : 's'}`;
}

export default class DailyCommand extends Command {
  static override info = {
    name: 'daily',
    description: 'Coleta recompensa diária de moedas',
    usage: '/daily',
    aliases: ['reward', 'recompensa', 'diario']
  }

  static override async execute(ctx: IncomingCommand) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    if (user.hasGottenDaily) {
      await reply(ctx, `Você já pegou sua recompensa diária hoje. 😊\nVolte daqui ${getTimeUntilMidnight()}.`)
      return
    }

    const streak = user.dailyStreak + 1
    let added = 100
    let weeklyBonus = ''

    if (streak % 7 === 0) {
      weeklyBonus = '🔥 Vi aqui e você obteve seu daily por uma semana sem falta! Que dedicação...\nTe dei mais dinheiro pelo seu esforço.\n\n'
      added += 100
    }

    if (streak % 30 === 0) {
      await UsersDB.updateUserMaxDraws(user.id, 2)
      added += 400
      weeklyBonus = '🥵 Vi aqui e você obteve seu daily por um mês sem falta! Que dedicação...\nTe dei mais dois giros por dia e mais dinheiro pelos seus esforços.\n\n'
    }

    added = added * 2
    added = await EconomyDB.applyIncomeInflation(added)
    const daysToNextBonus = 7 - (streak % 7)

    await UsersDB.setDailyGotten(user.id, streak)
    await UsersDB.addCoins(user.id, added)

    const formatter = new Intl.NumberFormat('pt-BR')
    const addedFormatted = formatter.format(added)

    const replyText = `💰 Você obteve **${addedFormatted}** moedas! 💰\n\n${weeklyBonus}📆 Continue pegando seu daily todo dia por mais **${daysToNextBonus} dia${daysToNextBonus === 1 ? '' : 's'}** para receber um bônus.\n🚒 **${streak} dia${streak === 1 ? '' : 's'}** pegando o daily consecutivamente`

    await reply(ctx, replyText)
  }
}
