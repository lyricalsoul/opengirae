import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB, InsufficientCardError } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { resolveDonationParties, confirmByAuthor, reportTransferFailure } from '../../services/donations/shared'
import { buildCtx } from '../../services/syntheticCtx'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'
import { emitCardsNew } from '../../loaders/hooks'

const CONFIRM_EVENT = 'doarclc:confirm'
const CONFIRM_LIST_LIMIT = 20

// caps a rendered card list so messages can't blow past Telegram's ~4096 char limit
function renderCardList(lines: string[]): string {
  if (lines.length <= CONFIRM_LIST_LIMIT) return lines.join('\n');
  return `${lines.slice(0, CONFIRM_LIST_LIMIT).join('\n')}\n…e mais ${lines.length - CONFIRM_LIST_LIMIT}`;
}

export default class DoarClcCommand extends Command {
  static override info = {
    name: 'doarclc',
    description: 'Doa todos os cards que você tem de uma coleção para outro usuário',
    usage: '/doarclc <ID ou nome do usuário> <nome ou ID da coleção> (ou em resposta ao usuário)',
    aliases: ['doarcolecao', 'doarsub'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([
    { name: 'target', type: CommandArgumentType.USER_MENTION },
    { name: 'subcategory', type: CommandArgumentType.SUBCATEGORY },
  ])
  static override async execute(ctx: IncomingCommand, args: { target: string; subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const parties = await resolveDonationParties(ctx, args.target, 'cartas')
    if (!parties) return
    const { platform, donor, recipient } = parties

    const subcategoryCards = await CardsDB.getCardsInSubcategoryForUser(args.subcategory.id, donor.id)
    const owned = subcategoryCards.filter(c => c.ownedCount > 0)
    if (owned.length === 0) {
      await reply(ctx, `Você não tem nenhum card da coleção **${escapeMarkdown(args.subcategory.name)}** para doar.`)
      return
    }

    const offerA = owned.map(c => ({ cardId: c.id, count: c.ownedCount }))
    const totalQty = offerA.reduce((sum, o) => sum + o.count, 0)
    const list = renderCardList(owned.map(c => {
      const qtySuffix = c.ownedCount > 1 ? ` (\`${c.ownedCount}x\`)` : ''
      return `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**${qtySuffix}`
    }))

    const confirmContent = `Doar toda a sua coleção **${escapeMarkdown(args.subcategory.name)}** (**${totalQty}** carta(s)) para **${escapeMarkdown(recipient.displayName)}**?\n\n${list}`

    if (!(await confirmByAuthor(ctx, CONFIRM_EVENT, confirmContent))) return

    let crossings: { userId: number; cardId: number; previousCount: number; newCount: number }[]
    try {
      const incomeInflationRate = await EconomyDB.getIncomeInflationRate()
      const result = await CardsDB.executeTrade(donor.id, offerA, recipient.id, [], incomeInflationRate)
      crossings = result.crossings
    } catch (e) {
      if (e instanceof InsufficientCardError) {
        await reply(ctx, 'Não foi possível completar a doação: você não tem mais uma das cartas selecionadas.')
      } else {
        await reportTransferFailure(ctx, 'doarclc', 'doação', e)
      }
      return
    }

    await AuditDB.log(donor.id, 'card.doarclc', { recipientUserId: recipient.id, subcategoryId: args.subcategory.id, cards: offerA })

    const dm = buildCtx(platform, args.target, recipient.displayName, args.target)
    await reply(dm, `💱 ${mention(platform, ctx.message.author.id, donor.displayName)} te doou toda a coleção **${escapeMarkdown(args.subcategory.name)}** (**${totalQty}** carta(s))!\n\n${list}`)

    await reply(ctx, `💱 Pronto! Sua coleção **${escapeMarkdown(args.subcategory.name)}** (**${totalQty}** carta(s)) foi doada para **${escapeMarkdown(recipient.displayName)}**.`)

    await emitCardsNew(recipient.id, args.target, recipient.displayName, platform, crossings.filter(c => c.userId === recipient.id))
  }
}
