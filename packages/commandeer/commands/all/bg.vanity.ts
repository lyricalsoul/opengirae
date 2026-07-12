import { Command, Page } from '@girae/common/commands'
import { reply, toPageButton } from '@girae/common/dbos/messaging'
import { VanitiesDB } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../../constants'
import { buildFilterArg } from '@girae/common/utilities/pageFilters'
import { renderVanityBrowsePage, type VanityType } from '../../services/vanityBrowser'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

async function renderItem(itemId: number, type: VanityType, viewerTelegramId: string) {
  const item = await VanitiesDB.getStoreItemById(itemId)
  if (!item || item.type !== type) return null

  const user = await UsersDB.getUserByTelegramId(viewerTelegramId)
  const owned = user ? await VanitiesDB.hasBought(user.id, item.id) : false

  const content = `**${escapeMarkdown(item.title)}**
${escapeMarkdown(item.description)}
💸 ${item.price} moedas${owned ? '\n✅ Você possui este item.' : ''}`

  const button = owned
    ? { text: '✅ Equipar', quickView: { handler: 'equip', arg: `${item.type}:${item.id}` } }
    : { text: '💸 Comprar', runCommand: { name: 'comprar', args: [String(item.id)] } }

  return { content, photoUrl: item.itemURL, button }
}

export default class BackgroundCommand extends Command {
  static override info = {
    name: 'bg',
    description: 'Vê ou busca papéis de parede na loja',
    usage: '/bg [ID ou busca]',
    aliases: ['background', 'papeldeparede'],
  }

  static override async execute(ctx: IncomingCommand) {
    const query = ctx.args.join(' ').trim()

    if (!query) {
      const arg = buildFilterArg([], 'background')
      const page = await renderVanityBrowsePage(arg, 0, ctx.message.author.id)
      await reply(ctx, {
        content: page.content,
        buttonRows: [
          ...page.extraRows.map(row => row.map(b => toPageButton('vanities', b))),
          ...(page.hasNext ? [[toPageButton('vanities', { text: 'Próxima ➡️', arg, page: 1 })]] : []),
        ],
      })
      return
    }

    const asId = parseInt(query, 10)
    if (!isNaN(asId)) {
      const view = await renderItem(asId, 'background', ctx.message.author.id)
      if (!view) {
        await reply(ctx, 'Não encontrei um papel de parede com esse ID.')
        return
      }
      await reply(ctx, { content: view.content, photoUrl: view.photoUrl, buttons: [view.button] })
      return
    }

    const results = await VanitiesDB.searchStoreItemsByType('background', query, 100)
    if (results.length === 0) {
      await reply(ctx, 'Não encontrei um papel de parede com esse nome.')
      return
    }
    if (results.length === 1) {
      const view = await renderItem(results[0]!.id, 'background', ctx.message.author.id)
      if (view) await reply(ctx, { content: view.content, photoUrl: view.photoUrl, buttons: [view.button] })
      return
    }

    const list = results.map(i => `💸 \`${i.id}\`. **${escapeMarkdown(i.title)}** — ${i.price} moedas`).join('\n')
    await reply(ctx, `${EMOJI.search} **${results.length}** resultados encontrados:\n\n${list}\n\nPara ver um desses itens, use \`/bg id\``)
  }

  @Page({ name: 'vanities', restricted: true })
  static async vanitiesPage(arg: string, page: number, authorId: string) {
    return renderVanityBrowsePage(arg, page, authorId)
  }
}
