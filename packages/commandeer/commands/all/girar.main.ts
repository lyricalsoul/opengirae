import { Command, type CommandContext } from '@girae/common/commands'
import { getCategories, getSubcategoriesForCategoryDraw } from '@girae/database/cards'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class GirarCommand extends Command {
  static override info = {
    name: 'girar',
    description: 'Tente a sorte e puxe uma carta!',
    aliases: ['rodar', 'rechear', 'carimbar', 'draw', 'gi'],
    useWorkflow: true
  }

  static CATEGORY_SELECTED_EVENT = 'categorySelected'
  static SUBCATEGORY_SELECTED_EVENT = 'subcategorySelected'

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    const categories = await getCategories()
    await reply(cmd, {
      content: 'Escolha uma categoria...',
      options: categories.map((c) =>
        restrictedToUser({ data: c.id, user: ctx.author.id, title: `${c.emoji} ${c.name}` }))
    })

    const categoryId = await DBOS.recv<number>(GirarCommand.CATEGORY_SELECTED_EVENT)
    if (!categoryId) return

    const subcategories = await getSubcategoriesForCategoryDraw(categoryId)
    await reply(cmd, {
      content: 'Escolha uma subcategoria...',
      options: subcategories.map((c) =>
        restrictedToUser({ data: c.id, user: ctx.author.id, title: c.name }))
    })

    const subcategoryId = await DBOS.recv<number>(GirarCommand.SUBCATEGORY_SELECTED_EVENT)
    if (!subcategoryId) return

    // make card selection
  }
}
