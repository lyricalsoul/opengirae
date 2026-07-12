import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { getContrastingColor } from '../../utilities/color'

const HEX_COLOR_REGEX = /^#?[0-9a-fA-F]{6}$/

export default class FavColorCommand extends Command {
  static override info = {
    name: 'favcolor',
    description: 'Define sua cor favorita do perfil',
    usage: '/favcolor <#hex>',
    aliases: ['cor', 'color', 'corfav', 'corfavorita']
  }

  static override async execute(ctx: IncomingCommand) {
    const arg = ctx.args[0]
    if (!arg) {
      await reply(ctx, 'Uso: `/favcolor <#hex>`\nExemplo: `/favcolor #ff0000`')
      return
    }

    if (!HEX_COLOR_REGEX.test(arg)) {
      await reply(ctx, 'Não consegui encontrar um código HEX válido. 😔')
      return
    }

    const color = arg.startsWith('#') ? arg : `#${arg}`

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    await UsersDB.updateUserProfile(user.id, { favoriteColor: color })

    const colorNoHash = color.slice(1)
    const previewUrl = `https://placehold.co/600x400/${colorNoHash}/${getContrastingColor(color)}.png?text=${colorNoHash}`

    await reply(ctx, {
      content: `🌈 A cor **${color}** é agora a sua cor favorita!`,
      photoUrl: previewUrl
    })
  }
}
