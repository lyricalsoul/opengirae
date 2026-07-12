import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'

const MAX_BIO_LENGTH = 100

export default class BioCommand extends Command {
  static override info = {
    name: 'bio',
    description: 'Define sua biografia do perfil',
    usage: '/bio <texto>',
    aliases: ['biografia', 'biography']
  }

  static override async execute(ctx: IncomingCommand) {
    const bio = ctx.args.join(' ').trim()
    if (!bio) {
      await reply(ctx, 'Uso: `/bio <texto>`\nExemplo: `/bio Sou fofa e divertida 😊`')
      return
    }

    if (bio.length > MAX_BIO_LENGTH) {
      await reply(ctx, `Desculpe, mas a sua biografia não pode ter mais de ${MAX_BIO_LENGTH} caracteres. 😅`)
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    await UsersDB.updateUserProfile(user.id, { bio })
    await reply(ctx, `📝 Sua biografia foi atualizada para:\n\n\`${bio}\``)
  }
}
