import { Command, QuickView } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

const FALLBACK_IMAGE = 'https://placehold.co/900x1260/png'

async function showCard(ctx: IncomingCommand, card: CardDetails) {
  const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
  const [owned, tags] = await Promise.all([
    user ? CardsDB.getUserCard(user.id, card.id) : null,
    CardsDB.getSecondarySubcategoryNames(card.id),
  ])
  const count = owned?.count ?? 0
  const badge = cativeiroEmoji(count)

  const tagLine = tags.length > 0 ? `\n${EMOJI.tag} ${tags.map(escapeMarkdown).join(', ')}` : ''
  const countSuffix = count > 0 ? ` (\`${count}x\`)` : ''

  const text = `${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**${badge ? ` ${badge}` : ''}
${card.categoryEmoji ?? EMOJI.category} _${escapeMarkdown(card.subcategoryName ?? '?')}_${tagLine}

${EMOJI.owner} \`${user?.id ?? '?'}\`. [${escapeMarkdown(ctx.message.author.name)}](tg://user?id=${ctx.message.author.id})${countSuffix}`

  await reply(ctx, {
    content: text,
    photoUrl: card.imageUrl ?? FALLBACK_IMAGE,
    buttons: [{ text: EMOJI.quickView, quickView: { handler: 'cardinfo', arg: String(card.id) } }],
  })
}

export default class CardCommand extends Command {
  static override info = {
    name: 'card',
    description: 'Busca e visualiza informações de uma carta',
    usage: '/card <nome ou ID do personagem>',
    aliases: ['view', 'ver'],
  }

  static override async execute(ctx: IncomingCommand) {
    const query = ctx.args.join(' ').trim()
    if (!query) {
      await reply(ctx, 'Uso: `/card <nome ou ID do personagem>`')
      return
    }

    const asId = parseInt(query, 10)
    if (!isNaN(asId)) {
      const card = await CardsDB.getCardWithDetails(asId)
      if (!card) {
        await reply(ctx, 'Não encontrei um personagem com esse ID.')
        return
      }
      await showCard(ctx, card)
      return
    }

    const results = await CardsDB.searchCardsByName(query, 100)
    if (results.length === 0) {
      await reply(ctx, 'Não encontrei um personagem com esse nome.')
      return
    }
    if (results.length === 1) {
      const card = await CardsDB.getCardWithDetails(results[0]!.id)
      if (card) await showCard(ctx, card)
      return
    }

    const list = results
      .map(c => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** ${c.categoryEmoji ?? ''} _${escapeMarkdown(c.subcategoryName ?? '')}_`)
      .join('\n')
    await reply(ctx, `${EMOJI.search} **${results.length}** resultados encontrados:\n\n${list}\n\nPara ver um desses cards, use \`/card id\``)
  }

  @QuickView({ name: 'cardinfo' })
  static async cardinfo(arg: string): Promise<string> {
    const cardId = parseInt(arg, 10)
    const card = await CardsDB.getCardWithDetails(cardId)
    if (!card) return 'Não encontrei esse card.'

    const [owners, copies] = await Promise.all([
      CardsDB.getCardOwnerCount(cardId),
      CardsDB.getCardTotalCopies(cardId),
    ])

    return `${card.rarityEmoji} Informações de ${card.name}

${EMOJI.ownersCount} ${owners} pessoa${owners === 1 ? '' : 's'} com este card
${EMOJI.circulation} ${copies} vez${copies === 1 ? '' : 'es'} girado`
  }
}
