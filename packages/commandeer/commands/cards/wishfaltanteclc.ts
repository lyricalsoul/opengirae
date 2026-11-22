import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_LIST_LIMIT = 20

// caps a rendered card list so messages can't blow past Telegram's ~4096 char limit
function renderCardList(lines: string[]): string {
  if (lines.length <= CONFIRM_LIST_LIMIT) return lines.join('\n');
  return `${lines.slice(0, CONFIRM_LIST_LIMIT).join('\n')}\n…e mais ${lines.length - CONFIRM_LIST_LIMIT}`;
}

export default class WishFaltanteClcCommand extends Command {
  static override info = {
    name: 'wishfaltanteclc',
    description: 'Adiciona à lista de desejos todos os cards que faltam de uma coleção',
    usage: '/wishfaltanteclc <nome ou ID da coleção>',
  }

  @CommandArgument([{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY }])
  static override async execute(ctx: IncomingCommand, args: { subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const subcategoryCards = await CardsDB.getCardsInSubcategoryForUser(args.subcategory.id, user.id)
    const missing = subcategoryCards.filter(c => c.ownedCount === 0)
    if (missing.length === 0) {
      await reply(ctx, `Você já tem todos os cards da coleção **${escapeMarkdown(args.subcategory.name)}**. Nada para adicionar à lista de desejos.`)
      return
    }

    const addedIds = await CardsDB.addManyToWishlist(user.id, missing.map(c => c.id))
    if (addedIds.length === 0) {
      await reply(ctx, `Todos os cards que faltam da coleção **${escapeMarkdown(args.subcategory.name)}** já estavam na sua lista de desejos.`)
      return
    }

    const addedIdSet = new Set(addedIds)
    const list = renderCardList(missing.filter(c => addedIdSet.has(c.id)).map(c => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**`))
    const skippedNote = addedIds.length < missing.length
      ? `\n\n_${missing.length - addedIds.length} já estavam na sua lista de desejos._`
      : ''

    await reply(ctx, `💝 Adicionei **${addedIds.length}** card(s) que faltam da coleção **${escapeMarkdown(args.subcategory.name)}** à sua lista de desejos:\n\n${list}${skippedNote}`)
  }
}
