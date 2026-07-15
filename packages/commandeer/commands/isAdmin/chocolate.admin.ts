import { Command } from '@girae/common/commands'
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

  static override async execute(ctx: IncomingCommand) {
    const [idRaw, ...nameParts] = ctx.args
    const subcategoryId = parseInt(idRaw ?? '', 10)
    const targetName = nameParts.join(' ').trim()

    if (isNaN(subcategoryId) || !targetName) {
      await reply(ctx, 'Uso: `/chocolate <id da subcategoria> <nome a corrigir>`')
      return
    }

    const subcategory = await CardsDB.getSubcategory(subcategoryId)
    if (!subcategory) {
      await reply(ctx, 'Subcategoria não encontrada.')
      return
    }

    await CardsDB.upsertCorrection(targetName, subcategoryId)
    await reply(ctx, `🍫 Toda vez que "${escapeMarkdown(targetName)}" aparecer, será tratado como **${escapeMarkdown(subcategory.name)}** (\`${subcategory.id}\`).`)
  }
}
