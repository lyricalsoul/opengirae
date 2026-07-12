import { Command } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../../constants'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class SetCardSubcategoryCommand extends Command {
  static override info = {
    name: 'setcardsub',
    description: 'Muda a subcategoria principal de um card (staff)',
    usage: '/setcardsub <ID do card> <ID ou nome da subcategoria>',
    aliases: ['setcardsubcat']
  }

  static override async execute(ctx: IncomingCommand) {
    const cardId = parseInt(ctx.args[0] ?? '', 10)
    const query = ctx.args.slice(1).join(' ').trim()

    if (isNaN(cardId) || !query) {
      await reply(ctx, 'Uso: `/setcardsub <ID do card> <ID ou nome da subcategoria>`')
      return
    }

    const card = await CardsDB.getCard(cardId)
    if (!card) {
      await reply(ctx, 'Card não encontrado.')
      return
    }

    const asId = parseInt(query, 10)
    let subcategory = !isNaN(asId) ? await CardsDB.getSubcategory(asId) : undefined
    if (!subcategory && isNaN(asId)) {
      const results = await CardsDB.searchSubcategoriesByName(query, 100)
      if (results.length === 0) {
        await reply(ctx, 'Não encontrei uma subcategoria com esse nome.')
        return
      }
      if (results.length > 1) {
        const list = results.map(s => `${s.categoryEmoji} \`${s.id}\`. **${escapeMarkdown(s.name)}**`).join('\n')
        await reply(ctx, `${EMOJI.search} **${results.length}** resultados encontrados:\n\n${list}\n\nUse o ID: \`/setcardsub ${cardId} id\``)
        return
      }
      subcategory = await CardsDB.getSubcategory(results[0]!.id)
    }
    if (!subcategory) {
      await reply(ctx, 'Não encontrei uma subcategoria com esse ID.')
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    await CardsDB.setCardMainSubcategory(card.id, subcategory.id)
    await AuditDB.log(user.id, 'card.subcategoryUpdate', { cardId: card.id, name: card.name, subcategoryId: subcategory.id, subcategoryName: subcategory.name })

    await reply(ctx, `🃏 Subcategoria de **${escapeMarkdown(card.name)}** alterada para **${escapeMarkdown(subcategory.name)}**.`)
  }
}
