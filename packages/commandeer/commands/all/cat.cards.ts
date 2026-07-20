import { Command, Page, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../../constants'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const PAGE_SIZE = 20

async function renderPage(categoryId: number, page: number) {
  const category = await CardsDB.getCategory(categoryId)
  if (!category) return null

  const subs = await CardsDB.getSubcategoriesWithCardCounts(categoryId)
  const totalPages = Math.max(1, Math.ceil(subs.length / PAGE_SIZE))
  const slice = subs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const rows = slice.length > 0
    ? slice.map(s => `${EMOJI.subcategory} \`${s.id}\`. **${escapeMarkdown(s.name)}** (\`${s.cardCount}\` cards)`).join('\n')
    : '_Nenhuma subcategoria._'
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''

  const content = `${category.emoji} \`${category.id}\`. **${escapeMarkdown(category.name)}**
${EMOJI.dice} \`${subs.length}\` subcategorias no total.

${rows}

${pageInfo}${EMOJI.browse} Para ver uma dessas subcategorias, use \`/clc id\`.`

  return { content, photoUrl: category.drawImageUrl ?? undefined, hasNext: page < totalPages - 1, totalPages }
}

async function replyAllCategories(ctx: IncomingCommand, header: string) {
  const categories = await CardsDB.getCategories()
  const list = categories.map(c => `${c.emoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**`).join('\n')
  await reply(ctx, `${header}\n\n${list}`)
}

export default class CategoryCommand extends Command {
  static override info = {
    name: 'cat',
    description: 'Mostra uma categoria e suas subcategorias',
    usage: '/cat [nome ou ID da categoria]',
    aliases: ['cats', 'ctg'],
  }

  @CommandArgument([{ name: 'category', type: CommandArgumentType.CATEGORY, nullable: true, description: 'ID ou nome da categoria' }])
  static override async execute(ctx: IncomingCommand, args: { category?: NonNullable<Awaited<ReturnType<typeof CardsDB.getCategory>>> }) {
    if (!args.category) {
      await replyAllCategories(ctx, 'Escolha uma categoria:')
      return
    }

    const page = await renderPage(args.category.id, 0)
    if (!page) return

    const navRow = pageNavRow('cat', String(args.category.id), 0, page.hasNext, page.totalPages)
    await reply(ctx, {
      content: page.content,
      photoUrl: page.photoUrl,
      buttonRows: navRow.length ? [navRow] : undefined,
    })
  }

  @Page({ name: 'cat', restricted: true })
  static async catPage(arg: string, page: number) {
    return renderPage(parseInt(arg, 10), page)
  }
}
