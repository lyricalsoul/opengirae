import { Command, Page, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply, toPageButton, pageNavRow } from '@girae/common/dbos/messaging'
import { VanitiesDB } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { buildFilterArg } from '@girae/common/utilities/pageFilters'
import { renderVanityBrowsePage } from '../../services/vanityBrowser'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

type VanityItem = NonNullable<Awaited<ReturnType<typeof VanitiesDB.getStoreItemById>>>

async function renderItem(item: VanityItem, viewerTelegramId: string, platform: 'telegram' | 'discord') {
  const user = await UsersDB.getUserByPlatformAccount(platform, viewerTelegramId)
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

  @CommandArgument([{ name: 'item', type: CommandArgumentType.VANITY_ITEM, vanityType: 'background', nullable: true }])
  static override async execute(ctx: IncomingCommand, args: { item?: VanityItem }) {
    if (!args.item) {
      const arg = buildFilterArg([], 'background')
      const page = await renderVanityBrowsePage(arg, 0, ctx.message.author.id, ctx.message.platform as 'telegram' | 'discord')
      const navRow = pageNavRow('vanities', arg, 0, page.hasNext, page.totalPages)
      await reply(ctx, {
        content: page.content,
        buttonRows: [
          ...page.extraRows.map(row => row.map(b => toPageButton('vanities', b))),
          ...(navRow.length ? [navRow] : []),
        ],
      })
      return
    }

    const view = await renderItem(args.item, ctx.message.author.id, ctx.message.platform as 'telegram' | 'discord')
    await reply(ctx, { content: view.content, photoUrl: view.photoUrl, buttons: [view.button] })
  }

  @Page({ name: 'vanities', restricted: true })
  static async vanitiesPage(arg: string, page: number, authorId: string, platform: 'telegram' | 'discord') {
    return renderVanityBrowsePage(arg, page, authorId, platform)
  }
}
