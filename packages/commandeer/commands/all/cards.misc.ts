import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { getBotUsername } from '../../services/botInfo'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class CardsLinkCommand extends Command {
  static override info = {
    name: 'cards',
    description: 'Envia o link para ver seus cards no mini app',
    usage: '/cards',
  }

  static override async execute(ctx: IncomingCommand) {
    const botUsername = await getBotUsername()
    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!viewer) return

    const replyToId = ctx.message.replyTo?.author.id
    if (!replyToId) {
      await reply(ctx, `[Veja seus cards aqui](https://t.me/${botUsername}/cards?startapp=${viewer.id})`)
      return
    }

    const target = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', replyToId)
    if (!target) {
      await reply(ctx, 'Esse usuário nunca usou a bot!')
      return
    }
    if (!UsersDB.isViewable(viewer.id, target)) {
      await reply(ctx, 'Esse usuario tem o modo de privacidade ativo e não é possível ver os cards dele. 🔒')
      return
    }

    await reply(ctx, `[Veja os cards de ${escapeMarkdown(target.displayName)} aqui](https://t.me/${botUsername}/cards?startapp=${target.id})`)
  }
}
