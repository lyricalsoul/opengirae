import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { MAX_BIO_LENGTH } from '@girae/database/constants'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class BioCommand extends Command {
  static override info = {
    name: 'bio',
    description: 'Define sua biografia do perfil',
    usage: '/bio <texto>',
    aliases: ['biografia', 'biography']
  }

  @CommandArgument([{
    name: 'bio', type: CommandArgumentType.STRING,
    guard: (v: string) => v.length <= MAX_BIO_LENGTH || `Desculpe, mas a sua biografia não pode ter mais de ${MAX_BIO_LENGTH} caracteres. 😅`,
  }])
  static override async execute(ctx: IncomingCommand, args: { bio: string }) {
    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    await UsersDB.updateUserProfile(user.id, { bio: args.bio })
    await reply(ctx, `📝 Sua biografia foi atualizada para:\n\n\`${args.bio}\``)
  }
}
