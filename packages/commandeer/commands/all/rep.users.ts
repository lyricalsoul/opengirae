import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { mention } from '@girae/common/utilities/mention'

export default class RepCommand extends Command {
  static override info = {
    name: 'rep',
    description: 'Dá um ponto de reputação a outro usuário (uma vez por dia)',
    usage: '/rep @usuário (ou em resposta ao usuário)',
    aliases: ['reputacao', 'reputação'],
  }

  @CommandArgument([{ name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário para dar reputação' }])
  static override async execute(ctx: IncomingCommand, args: { target: string }) {
    const targetPlatformId = args.target

    if (targetPlatformId === ctx.message.author.id) {
      await reply(ctx, 'Você não pode dar reputação para si mesmo! 😅')
      return
    }

    const giver = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!giver) return

    if (giver.hasGivenRepToday) {
      await reply(ctx, 'Você já deu sua reputação de hoje! 🌠\nVolte amanhã para dar novamente.')
      return
    }

    const target = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', targetPlatformId)
    if (!target) {
      await reply(ctx, 'O usuário mencionado nunca usou a bot! Talvez você marcou a pessoa errada?')
      return
    }

    await UsersDB.setRepGiven(giver.id)
    await UsersDB.addReputation(target.id, 1)

    const targetName = mention(ctx.message.platform, targetPlatformId, target.displayName)
    await reply(ctx, `🌠 Que querido! Você deu um ponto de reputação para ${targetName}.`)
  }
}
