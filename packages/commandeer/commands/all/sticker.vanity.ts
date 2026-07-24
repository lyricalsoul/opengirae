import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply, toPageButton, pageNavRow } from '@girae/common/dbos/messaging'
import { VanitiesDB } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import type { IncomingCommand } from '@girae/common/commands/types'
import { buildFilterArg } from '@girae/common/utilities/pageFilters'
import { renderVanityBrowsePage } from '../../services/vanityBrowser'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

type VanityItem = NonNullable<Awaited<ReturnType<typeof VanitiesDB.getStoreItemById>>>

async function renderItem(item: VanityItem, viewerTelegramId: string, platform: 'telegram' | 'discord') {
  const [user, displayPrice] = await Promise.all([
    UsersDB.getUserByPlatformAccount(platform, viewerTelegramId),
    EconomyDB.applyInflation(item.price),
  ])
  const owned = user ? await VanitiesDB.hasBought(user.id, item.id) : false

  const content = `**${escapeMarkdown(item.title)}**
${escapeMarkdown(item.description)}
💸 ${displayPrice} moedas${owned ? '\n✅ Você possui este item.' : ''}`

  const button = owned
    ? { text: '✅ Equipar', quickView: { handler: 'equip', arg: `${item.type}:${item.id}` } }
    : { text: '💸 Comprar', runCommand: { name: 'comprar', args: [String(item.id)] } }

  return { content, photoUrl: item.itemURL, button }
}

export default class StickerCommand extends Command {
  static override info = {
    name: 'sticker',
    description: 'Vê ou busca stickers na loja',
    usage: '/sticker [ID ou busca]',
    aliases: ['figurinha'],
  }

  @CommandArgument([{ name: 'item', type: CommandArgumentType.VANITY_ITEM, vanityType: 'sticker', nullable: true, description: 'ID ou nome da figurinha' }])
  static override async execute(ctx: IncomingCommand, args: { item?: VanityItem }) {
    if (!args.item) {
      const arg = buildFilterArg([], 'sticker')
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
}
