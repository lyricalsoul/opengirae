import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { getContrastingColor } from '../../utilities/color'

export default class FavColorCommand extends Command {
  static override info = {
    name: 'favcolor',
    description: 'Define sua cor favorita do perfil',
    usage: '/favcolor <#hex>',
    aliases: ['cor', 'color', 'corfav', 'corfavorita']
  }

  @CommandArgument([{ name: 'color', type: CommandArgumentType.HEX_COLOR }])
  static override async execute(ctx: IncomingCommand, args: { color: string }) {
    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    await UsersDB.updateUserProfile(user.id, { favoriteColor: args.color })

    const colorNoHash = args.color.slice(1)
    const previewUrl = `https://placehold.co/600x400/${colorNoHash}/${getContrastingColor(args.color)}.png?text=${colorNoHash}`

    await reply(ctx, {
      content: `🌈 A cor **${args.color}** é agora a sua cor favorita!`,
      photoUrl: previewUrl
    })
  }
}
