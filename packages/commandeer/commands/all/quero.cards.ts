import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { resolveSubcategoryByIdOrName } from '../../services/commandArguments'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { EMOJI } from '../../constants'

const MAX_IDS = 50

export default class QueroCommand extends Command {
  static override info = {
    name: 'quero',
    description: 'Marca ou desmarca uma coleção como favorita (usada pelo /girarauto)',
    usage: '/quero <id ou nome da coleção>',
  }

  static override async execute(ctx: IncomingCommand) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const rawArgs = ctx.args.join(' ').trim()
    if (!rawArgs) {
      await reply(ctx, `Uso: \`${QueroCommand.info.usage}\``)
      return
    }

    const tokens = rawArgs.split(/\s+/).filter(Boolean)

    if (tokens.length === 1 || !tokens.every(t => /^\d+$/.test(t))) {
      const outcome = await resolveSubcategoryByIdOrName(rawArgs)
      if (!outcome.ok) {
        await reply(ctx, outcome.message ?? `Uso: \`${QueroCommand.info.usage}\``)
        return
      }
      const subcategory = outcome.value as { id: number; name: string }

      const alreadyGoal = await CardsDB.isOnGoals(user.id, subcategory.id)
      if (alreadyGoal) {
        await CardsDB.removeFromGoals(user.id, subcategory.id)
        await reply(ctx, `💔 **${escapeMarkdown(subcategory.name)}** removida das suas coleções favoritas.`)
      } else {
        await CardsDB.addToGoals(user.id, subcategory.id)
        await reply(ctx, `${EMOJI.goal} **${escapeMarkdown(subcategory.name)}** adicionada às suas coleções favoritas.`)
      }
      return
    }

    if (tokens.length > MAX_IDS) {
      await reply(ctx, `Você só pode adicionar/remover até ${MAX_IDS} coleções de uma vez.`)
      return
    }

    const ids: number[] = []
    for (const token of tokens) {
      if (!/^\d+$/.test(token)) {
        await reply(ctx, `\`${escapeMarkdown(token)}\` não é um ID de coleção válido. Use IDs numéricos quando desejar várias coleções.`)
        return
      }
      ids.push(parseInt(token, 10))
    }

    const uniqueIds = [...new Set(ids)]
    const subcategoriesFound = await CardsDB.getSubcategoriesByIds(uniqueIds)
    const foundById = new Map(subcategoriesFound.map(s => [s.id, s]))

    const notFound = uniqueIds.filter(id => !foundById.has(id))
    if (notFound.length > 0) {
      await reply(ctx, `Não encontrei coleções com os IDs: ${notFound.map(id => `\`${id}\``).join(', ')}`)
      return
    }

    const added: string[] = []
    const removed: string[] = []

    for (const id of uniqueIds) {
      const subcategory = foundById.get(id)!
      const alreadyGoal = await CardsDB.isOnGoals(user.id, id)
      if (alreadyGoal) {
        await CardsDB.removeFromGoals(user.id, id)
        removed.push(`\`${subcategory.id}\`. **${escapeMarkdown(subcategory.name)}**`)
      } else {
        await CardsDB.addToGoals(user.id, id)
        added.push(`\`${subcategory.id}\`. **${escapeMarkdown(subcategory.name)}**`)
      }
    }

    const parts: string[] = []
    if (added.length > 0) parts.push(`${EMOJI.goal} **Adicionadas:**\n${added.join('\n')}`)
    if (removed.length > 0) parts.push(`💔 **Removidas:**\n${removed.join('\n')}`)
    await reply(ctx, parts.join('\n\n'))
  }
}
