import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class SetApelidoCommand extends Command {
  static override info = {
    name: 'setapelido',
    description: 'Adiciona um apelido a uma subcategoria (staff)',
    usage: '/setapelido <ID ou nome da subcategoria> <apelido>',
    aliases: ['addapelido'],
  }

  @CommandArgument([
    { name: 'subcategory', type: CommandArgumentType.SUBCATEGORY },
    { name: 'alias', type: CommandArgumentType.STRING },
  ])
  static override async execute(ctx: IncomingCommand, args: { subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>>; alias: string }) {
    const { subcategory, alias } = args

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    await CardsDB.addSubcategoryAlias(subcategory.id, alias)
    await AuditDB.log(user.id, 'subcategory.aliasAdd', { subcategoryId: subcategory.id, subcategoryName: subcategory.name, alias })

    await reply(ctx, `🏷 **${escapeMarkdown(alias.trim().toLowerCase())}** agora resolve para **${escapeMarkdown(subcategory.name)}**.`)
  }
}
