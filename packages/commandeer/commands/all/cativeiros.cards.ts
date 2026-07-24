import { Command, Page } from '@girae/common/commands'
import { reply, pageNavRow } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const PAGE_SIZE = 10

export async function renderPage(viewerUserIdArg: string, page: number) {
  const viewerId = parseInt(viewerUserIdArg, 10)
  const viewer = await UsersDB.getUserById(viewerId)
  if (!viewer) return null

  const { rows, total } = await CardsDB.getCativeiroEligibleCards(viewer.id, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (total === 0) {
    return {
      content: '😊 Você não tem nenhuma carta elegível para cativeiro ainda. Use /girar ou troque cartas no @chatdagirae!',
      hasNext: false,
      totalPages: 1,
    }
  }

  const cardLines = rows.map(c => {
    const subEmoji = c.subcategoryEmoji ? `${c.subcategoryEmoji} ` : ''
    const rarityOrCustom = c.customEmoji ?? c.rarityEmoji
    return `${subEmoji}${rarityOrCustom} \`${c.id}\`. **${escapeMarkdown(c.name)}** (\`${c.ownedCount}x\`)`
  }).join('\n')
  const pageInfo = totalPages > 1 ? `\n\n📃 Página \`${page + 1}\` de **${totalPages}**` : ''

  const content = `👤 \`${viewer.id}\`. Cativeiros de **${escapeMarkdown(viewer.displayName)}**
👑 \`${total}\` cativeiros ativos.

${cardLines}

Use \`/upload id\`.${pageInfo}`

  return { content, hasNext: page < totalPages - 1, totalPages }
}

export default class CativeirosCommand extends Command {
  static override info = {
    name: 'cativeiros',
    description: 'Mostra seus cards elegíveis para customização de cativeiro',
    usage: '/cativeiros',
  }

  static override async execute(ctx: IncomingCommand) {
    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!viewer) return

    const page = await renderPage(String(viewer.id), 0)
    if (!page) return

    const navRow = pageNavRow('cativeiros', String(viewer.id), 0, page.hasNext, page.totalPages)
    await reply(ctx, { content: page.content, buttonRows: navRow.length ? [navRow] : undefined })
  }

  @Page({ name: 'cativeiros', restricted: true })
  static async cativeirosPage(arg: string, page: number) {
    return renderPage(arg, page)
  }
}
