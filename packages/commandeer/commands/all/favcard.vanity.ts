import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../../constants'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class FavCardCommand extends Command {
  static override info = {
    name: 'favcard',
    description: 'Define sua carta favorita',
    usage: '/favcard <nome ou ID do personagem>',
    aliases: ['fav', 'favorito', 'favorite'],
  }

  static override async execute(ctx: IncomingCommand) {
    const query = ctx.args.join(' ').trim()
    if (!query) {
      await reply(ctx, 'Uso: `/favcard <nome ou ID do personagem>`')
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const asId = parseInt(query, 10)
    let card: Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>

    if (!isNaN(asId)) {
      card = await CardsDB.getCardWithDetails(asId)
      if (!card) {
        await reply(ctx, 'Não encontrei um personagem com esse ID.')
        return
      }
    } else {
      const results = await CardsDB.searchCardsByName(query, 100)
      if (results.length === 0) {
        await reply(ctx, 'Não encontrei um personagem com esse nome.')
        return
      }
      if (results.length > 1) {
        const list = results.map(c => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** ${c.categoryEmoji ?? ''} _${escapeMarkdown(c.subcategoryName ?? '')}_`).join('\n')
        await reply(ctx, `${EMOJI.search} **${results.length}** resultados encontrados:\n\n${list}\n\nPara favoritar um desses cards, use \`/favcard id\``)
        return
      }
      card = await CardsDB.getCardWithDetails(results[0]!.id)
      if (!card) return
    }

    if (!(await CardsDB.hasUserCard(user.id, card.id))) {
      await reply(ctx, 'Oops... parece que você ainda não tem esse personagem. 😅\nEncontre-o usando `/girar` para favoritá-lo.')
      return
    }

    await UsersDB.setFavoriteCard(user.id, card.id)

    await reply(ctx, {
      content: `🌟 **${escapeMarkdown(card.name)}** é agora o seu personagem favorito!`,
      photoUrl: card.imageUrl ?? undefined,
    })
  }
}
