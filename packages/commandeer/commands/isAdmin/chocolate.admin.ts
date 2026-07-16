import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class ChocolateCommand extends Command {
  static override info = {
    name: 'chocolate',
    description: 'Corrige um nome de subcategoria usado no formato colado do addcard (staff)',
    usage: '/chocolate <ID da subcategoria> <nome a corrigir>',
  }

  @CommandArgument([
    { name: 'subcategory', type: CommandArgumentType.SUBCATEGORY },
    { name: 'targetName', type: CommandArgumentType.STRING },
  ])
  static override async execute(ctx: IncomingCommand, args: { subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>>; targetName: string }) {
    const { subcategory, targetName } = args
    await CardsDB.upsertCorrection(targetName, subcategory.id)
    await reply(ctx, `🍫 Toda vez que "${escapeMarkdown(targetName)}" aparecer, será tratado como **${escapeMarkdown(subcategory.name)}** (\`${subcategory.id}\`).`)
  }
}
