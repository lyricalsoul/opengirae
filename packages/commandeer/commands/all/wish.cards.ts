import { Command, Page } from '@girae/common/commands'
import { reply, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../../constants'
import { resolveCardByIdOrName } from '../../services/commandArguments'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const PAGE_SIZE = 20

async function renderPage(targetUserIdArg: string, page: number) {
  const targetUserId = parseInt(targetUserIdArg, 10)
  const target = await UsersDB.getUserById(targetUserId)
  if (!target) return null

  const { rows, total } = await CardsDB.getWishlist(target.id, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const cardLines = rows.length > 0
    ? rows.map(c => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** — _${escapeMarkdown(c.subcategoryName ?? '?')}_`).join('\n')
    : '_A lista de desejos está vazia._'
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''

  const content = `💝 \`${target.id}\`. Lista de desejos de **${escapeMarkdown(target.displayName)}**
${EMOJI.dice} \`${total}\` card${total === 1 ? '' : 's'} na lista.

${cardLines}

${pageInfo}${EMOJI.browse} Para adicionar um card, use \`/wish id ou nome\`.`

  return { content, hasNext: page < totalPages - 1, totalPages }
}

async function isViewable(viewerTelegramId: string, target: NonNullable<Awaited<ReturnType<typeof UsersDB.getUserByTelegramId>>>) {
  if (target.telegramId === viewerTelegramId) return true
  return !target.privacyMode
}

export default class WishCommand extends Command {
  static override info = {
    name: 'wish',
    description: 'Mostra ou edita sua lista de desejos',
    usage: '/wish [id ou nome do card]',
    aliases: ['wishlist', 'wl'],
  }

  static override async execute(ctx: IncomingCommand) {
    const replyToId = ctx.message.replyTo?.author.id

    if (replyToId) {
      const target = await UsersDB.getUserByTelegramId(replyToId)
      if (!target) {
        await reply(ctx, 'Esse usuário nunca usou a bot!')
        return
      }
      if (!(await isViewable(ctx.message.author.id, target))) {
        await reply(ctx, 'Esse usuário ativou o modo privado e não é possível ver a lista de desejos dele. 🔒')
        return
      }

      const page = await renderPage(String(target.id), 0)
      if (!page) return

      const navRow = pageNavRow('wish', String(target.id), 0, page.hasNext, page.totalPages)
      await reply(ctx, { content: page.content, buttonRows: navRow.length ? [navRow] : undefined })
      return
    }

    const rawArgs = ctx.args.join(' ').trim()
    const viewer = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!viewer) return

    if (!rawArgs) {
      const page = await renderPage(String(viewer.id), 0)
      if (!page) return

      const navRow = pageNavRow('wish', String(viewer.id), 0, page.hasNext, page.totalPages)
      await reply(ctx, { content: page.content, buttonRows: navRow.length ? [navRow] : undefined })
      return
    }

    const outcome = await resolveCardByIdOrName(rawArgs)
    if (!outcome.ok) {
      await reply(ctx, outcome.message ?? 'Uso: `/wish id ou nome`')
      return
    }
    const card = outcome.value as { id: number; name: string }

    const alreadyOnList = await CardsDB.isOnWishlist(viewer.id, card.id)
    if (alreadyOnList) {
      await CardsDB.removeFromWishlist(viewer.id, card.id)
      await reply(ctx, `💔 **${escapeMarkdown(card.name)}** removido da sua lista de desejos.`)
    } else {
      await CardsDB.addToWishlist(viewer.id, card.id)
      await reply(ctx, `💝 **${escapeMarkdown(card.name)}** adicionado à sua lista de desejos.`)
    }
  }

  @Page({ name: 'wish' })
  static async wishPage(arg: string, page: number, authorId: string) {
    const targetUserId = parseInt(arg, 10)
    const target = await UsersDB.getUserById(targetUserId)
    if (!target) return null
    if (!(await isViewable(authorId, target))) return null

    return renderPage(arg, page)
  }
}
