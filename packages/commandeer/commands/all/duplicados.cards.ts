import { Command, Page } from '@girae/common/commands'
import { reply, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI, cativeiroEmoji } from '../../constants'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const PAGE_SIZE = 10

async function renderPage(viewerUserIdArg: string, page: number) {
  const viewerId = parseInt(viewerUserIdArg, 10)
  const viewer = await UsersDB.getUserById(viewerId)
  if (!viewer) return null

  const { rows, total } = await CardsDB.getDuplicateCards(viewer.id, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const cardLines = rows.length > 0
    ? rows.map(c => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}** \`${c.ownedCount}x\` ${cativeiroEmoji(c.ownedCount)} — _${escapeMarkdown(c.subcategoryName ?? '?')}_`).join('\n')
    : '_Você não tem cards duplicados._'
  const pageInfo = totalPages > 1 ? `${EMOJI.page} Página \`${page + 1}\` de **${totalPages}**\n` : ''

  const content = `${EMOJI.owner} \`${viewer.id}\`. Cards duplicados de **${escapeMarkdown(viewer.displayName)}**
${EMOJI.dice} \`${total}\` card${total === 1 ? '' : 's'} duplicado${total === 1 ? '' : 's'}.

${cardLines}

${pageInfo}${EMOJI.browse} Use \`/troco id ou nome\` para trocar um deles.`

  return { content, hasNext: page < totalPages - 1, totalPages }
}

export default class DuplicadosCommand extends Command {
  static override info = {
    name: 'duplicados',
    description: 'Mostra seus cards duplicados',
    usage: '/duplicados',
    aliases: ['dup', 'dupes', 'duplicatas'],
  }

  static override async execute(ctx: IncomingCommand) {
    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!viewer) return

    const page = await renderPage(String(viewer.id), 0)
    if (!page) return

    const navRow = pageNavRow('duplicados', String(viewer.id), 0, page.hasNext, page.totalPages)
    await reply(ctx, { content: page.content, buttonRows: navRow.length ? [navRow] : undefined })
  }

  @Page({ name: 'duplicados', restricted: true })
  static async duplicadosPage(arg: string, page: number) {
    return renderPage(arg, page)
  }
}
