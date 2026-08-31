import { Command, Page } from '@girae/common/commands'
import { reply, pageNavRow } from '@girae/common/dbos/messaging'
import { DiscotecaDB } from '@girae/database/discoteca'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../../constants'
import { resolveDiscotecaEntryByIdOrName } from '../../services/commandArguments'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const PAGE_SIZE = 10
const TYPE_EMOJI: Record<'album' | 'single', string> = { album: '💽', single: '🎵' }

function wishlistLine(e: { id: number; name: string; type: 'album' | 'single'; artistName: string; ownedCount: number }): string {
  const countSuffix = e.ownedCount > 0 ? ` \`${e.ownedCount}x\`` : ''
  return `${TYPE_EMOJI[e.type]} \`${e.id}\`. **${escapeMarkdown(e.name)}** — _${escapeMarkdown(e.artistName)}_${countSuffix}`
}

async function renderPage(targetUserIdArg: string, page: number) {
  const targetUserId = parseInt(targetUserIdArg, 10)
  const target = await UsersDB.getUserById(targetUserId)
  if (!target) return null

  const { rows, total } = await DiscotecaDB.getWishlist(target.id, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const lines = rows.length > 0
    ? rows.map(wishlistLine).join('\n')
    : '_A lista de desejos da discoteca está vazia._'
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''

  const content = `💝 \`${target.id}\`. Lista de desejos da discoteca de **${escapeMarkdown(target.displayName)}**
${EMOJI.dice} \`${total}\` item${total === 1 ? '' : 's'} na lista.

${lines}

${pageInfo}${EMOJI.browse} Para adicionar um álbum/single, use \`/wishdisco id ou nome\`.`

  return { content, hasNext: page < totalPages - 1, totalPages }
}

export default class WishDiscoCommand extends Command {
  static override info = {
    name: 'wishdisco',
    description: 'Mostra ou edita sua lista de desejos da discoteca',
    usage: '/wishdisco [id ou nome do álbum/single]',
    aliases: ['wishlistdisco', 'wldisco'],
  }

  static override async execute(ctx: IncomingCommand) {
    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!viewer) return

    const replyToId = ctx.message.replyTo?.author.id

    if (replyToId) {
      const target = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', replyToId)
      if (!target) {
        await reply(ctx, 'Esse usuário nunca usou a bot!')
        return
      }
      if (!UsersDB.isViewable(viewer.id, target)) {
        await reply(ctx, 'Esse usuário ativou o modo privado e não é possível ver a lista de desejos dele. 🔒')
        return
      }

      const page = await renderPage(String(target.id), 0)
      if (!page) return

      const navRow = pageNavRow('wishdisco', String(target.id), 0, page.hasNext, page.totalPages)
      await reply(ctx, { content: page.content, buttonRows: navRow.length ? [navRow] : undefined })
      return
    }

    const rawArgs = ctx.args.join(' ').trim()

    if (!rawArgs) {
      const page = await renderPage(String(viewer.id), 0)
      if (!page) return

      const navRow = pageNavRow('wishdisco', String(viewer.id), 0, page.hasNext, page.totalPages)
      await reply(ctx, { content: page.content, buttonRows: navRow.length ? [navRow] : undefined })
      return
    }

    const outcome = await resolveDiscotecaEntryByIdOrName(rawArgs)
    if (!outcome.ok) {
      await reply(ctx, outcome.message ?? `Uso: \`${this.info.usage}\``)
      return
    }
    const entry = outcome.value as { id: number; name: string }

    const alreadyOnList = await DiscotecaDB.isOnWishlist(viewer.id, entry.id)
    if (alreadyOnList) {
      await DiscotecaDB.removeFromWishlist(viewer.id, entry.id)
      await reply(ctx, `💔 **${escapeMarkdown(entry.name)}** removido da sua lista de desejos.`)
    } else {
      await DiscotecaDB.addToWishlist(viewer.id, entry.id)
      await reply(ctx, `💝 **${escapeMarkdown(entry.name)}** adicionado à sua lista de desejos.`)
    }
  }

  @Page({ name: 'wishdisco' })
  static async wishdiscoPage(arg: string, page: number, authorId: string, platform: 'telegram' | 'discord') {
    const targetUserId = parseInt(arg, 10)
    const target = await UsersDB.getUserById(targetUserId)
    if (!target) return null

    const viewer = await UsersDB.getUserByPlatformAccount(platform, authorId)
    if (!viewer) return null
    if (!UsersDB.isViewable(viewer.id, target)) return null

    return renderPage(arg, page)
  }
}
