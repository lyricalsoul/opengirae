import { Command, Page } from '@girae/common/commands'
import { reply, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../../constants'
import { resolveCardByIdOrName } from '../../services/commandArguments'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { generateWishlistImage } from '@girae/common/ditto'

const PAGE_SIZE = 10

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

  const dittoCards = rows
    .filter(c => c.imageUrl)
    .slice(0, 10)
    .map(c => ({ id: c.id, name: c.name, imageUrl: c.imageUrl! }))
  const image = dittoCards.length > 0 ? await generateWishlistImage(dittoCards) : null

  return { content, photoUrl: image?.url, hasNext: page < totalPages - 1, totalPages }
}

export default class WishCommand extends Command {
  static override info = {
    name: 'wish',
    description: 'Mostra ou edita sua lista de desejos',
    usage: '/wish [id ou nome do card]',
    aliases: ['wishlist', 'wl'],
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

      const navRow = pageNavRow('wish', String(target.id), 0, page.hasNext, page.totalPages)
      await reply(ctx, { content: page.content, photoUrl: page.photoUrl, buttonRows: navRow.length ? [navRow] : undefined })
      return
    }

    const rawArgs = ctx.args.join(' ').trim()

    if (!rawArgs) {
      const page = await renderPage(String(viewer.id), 0)
      if (!page) return

      const navRow = pageNavRow('wish', String(viewer.id), 0, page.hasNext, page.totalPages)
      await reply(ctx, { content: page.content, photoUrl: page.photoUrl, buttonRows: navRow.length ? [navRow] : undefined })
      return
    }

    const tokens = rawArgs.split(/\s+/).filter(Boolean)

    if (tokens.length === 1 || !tokens.every(t => /^\d+$/.test(t))) {
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
      return
    }

    const MAX_CARDS = 50
    if (tokens.length > MAX_CARDS) {
      await reply(ctx, `Você só pode adicionar/remover até ${MAX_CARDS} cards de uma vez.`)
      return
    }

    const cardIds: number[] = []
    for (const token of tokens) {
      if (!/^\d+$/.test(token)) {
        await reply(ctx, `\`${escapeMarkdown(token)}\` não é um ID de card válido. Use IDs numéricos quando desejar vários cards.`)
        return
      }
      cardIds.push(parseInt(token, 10))
    }

    const uniqueIds = [...new Set(cardIds)]
    const cards = await CardsDB.getCardsByIds(uniqueIds)
    const cardsById = new Map(cards.map(c => [c.id, c]))

    const notFound = uniqueIds.filter(id => !cardsById.has(id))
    if (notFound.length > 0) {
      await reply(ctx, `Não encontrei cards com os IDs: ${notFound.map(id => `\`${id}\``).join(', ')}`)
      return
    }

    const added: string[] = []
    const removed: string[] = []

    for (const id of uniqueIds) {
      const card = cardsById.get(id)!
      const alreadyOnList = await CardsDB.isOnWishlist(viewer.id, id)
      if (alreadyOnList) {
        await CardsDB.removeFromWishlist(viewer.id, id)
        removed.push(`${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**`)
      } else {
        await CardsDB.addToWishlist(viewer.id, id)
        added.push(`${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**`)
      }
    }

    const parts: string[] = []
    if (added.length > 0) parts.push(`💝 **Adicionados:**\n${added.join('\n')}`)
    if (removed.length > 0) parts.push(`💔 **Removidos:**\n${removed.join('\n')}`)
    await reply(ctx, parts.join('\n\n'))
  }

  @Page({ name: 'wish' })
  static async wishPage(arg: string, page: number, authorId: string, platform: 'telegram' | 'discord') {
    const targetUserId = parseInt(arg, 10)
    const target = await UsersDB.getUserById(targetUserId)
    if (!target) return null

    const viewer = await UsersDB.getUserByPlatformAccount(platform, authorId)
    if (!viewer) return null
    if (!UsersDB.isViewable(viewer.id, target)) return null

    return renderPage(arg, page)
  }
}
