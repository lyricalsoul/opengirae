import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import { resolveCardByIdOrName } from '../../services/commandArguments'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const MAX_CARDS = 50

export default class TrocoCommand extends Command {
  static override info = {
    name: 'troco',
    description: 'Marca uma ou várias cartas como trocáveis',
    usage: '/troco <id ou nome do card> [id2 id3 ...]',
  }

  @CommandArgument([{ name: 'cardsRaw', type: CommandArgumentType.STRING, description: 'ID(s) ou nome do card' }])
  static override async execute(ctx: IncomingCommand, args: { cardsRaw: string }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const tokens = args.cardsRaw.split(/\s+/).filter(Boolean)

    if (tokens.length === 1 || !tokens.every(t => /^\d+$/.test(t))) {
      const outcome = await resolveCardByIdOrName(args.cardsRaw)
      if (!outcome.ok) {
        await reply(ctx, outcome.message ?? `Uso: \`${this.info.usage}\``)
        return
      }
      const card = outcome.value as { id: number; name: string }
      if (!(await CardsDB.hasUserCard(user.id, card.id))) {
        await reply(ctx, '😂 Troca o que? Você não tem esse card.')
        return
      }
      await CardsDB.setCardTradable(user.id, card.id, true)
      await reply(ctx, `🔄 **${escapeMarkdown(card.name)}** agora está marcado como trocável.`)
      return
    }

    if (tokens.length > MAX_CARDS) {
      await reply(ctx, `Você só pode marcar até ${MAX_CARDS} cards de uma vez.`)
      return
    }

    const uniqueIds = [...new Set(tokens.map(t => parseInt(t, 10)))]
    const owned = await CardsDB.getOwnedCardQuantities(user.id, uniqueIds)
    const ownedIds = new Set(owned.map(o => o.cardId))

    const validIds = uniqueIds.filter(id => ownedIds.has(id))
    const skippedIds = uniqueIds.filter(id => !ownedIds.has(id))

    if (validIds.length === 0) {
      await reply(ctx, '😂 Troca o que? Você não tem nenhum desses cards.')
      return
    }

    const cards = await CardsDB.getCardsByIds(validIds)
    const cardsById = new Map(cards.map(c => [c.id, c]))
    for (const id of validIds) await CardsDB.setCardTradable(user.id, id, true)

    const list = validIds.map(id => {
      const c = cardsById.get(id)
      return c ? `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**` : `\`${id}\``
    }).join('\n')
    const skippedNote = skippedIds.length > 0 ? `\n\n⚠️ Ignorados (você não tem): ${skippedIds.map(id => `\`${id}\``).join(', ')}` : ''

    await reply(ctx, `🔄 **Marcados como trocáveis:**\n${list}${skippedNote}`)
  }
}
