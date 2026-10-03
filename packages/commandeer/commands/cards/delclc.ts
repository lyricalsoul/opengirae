import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import { calculateCardDiscardReward } from '@girae/database/constants'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'delclc:confirm'
const CONFIRM_LIST_LIMIT = 20

// caps a rendered card list so messages can't blow past Telegram's ~4096 char limit
function renderCardList(lines: string[]): string {
  if (lines.length <= CONFIRM_LIST_LIMIT) return lines.join('\n');
  return `${lines.slice(0, CONFIRM_LIST_LIMIT).join('\n')}\n…e mais ${lines.length - CONFIRM_LIST_LIMIT}`;
}

export default class DelClcCommand extends Command {
  static override info = {
    name: 'delclc',
    description: 'Descarta todos os cards que você tem de uma coleção em troca de moedas',
    usage: '/delclc <nome ou ID da coleção>',
    aliases: ['delcolecao', 'descartarclc'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY }])
  static override async execute(ctx: IncomingCommand, args: { subcategory: NonNullable<Awaited<ReturnType<typeof CardsDB.getSubcategory>>> }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const subcategoryCards = await CardsDB.getCardsInSubcategoryForUser(args.subcategory.id, user.id)
    const owned = subcategoryCards.filter(c => c.ownedCount > 0)
    if (owned.length === 0) {
      await reply(ctx, `Você não tem nenhum card da coleção **${escapeMarkdown(args.subcategory.name)}** para descartar.`)
      return
    }

    const cardIds = owned.flatMap(c => Array(c.ownedCount).fill(c.id))
    const totalQty = owned.reduce((sum, c) => sum + c.ownedCount, 0)

    const incomeInflationRate = await EconomyDB.getIncomeInflationRate()
    const estimatedTotal = owned.reduce((sum, c) => sum + calculateCardDiscardReward(c.rarityName, c.ownedCount, incomeInflationRate), 0)
    const list = renderCardList(owned.map(c => {
      const qtySuffix = c.ownedCount > 1 ? ` (\`${c.ownedCount}x\`)` : ''
      return `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**${qtySuffix}`
    }))

    const messageId = await reply(ctx, {
      content: `🗑 Descartar toda a sua coleção **${escapeMarkdown(args.subcategory.name)}** (**${totalQty}** carta(s))?\n\n${list}\n\nVocê receberá **${estimatedTotal}** moedas. Essa ação não pode ser desfeita.`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const selection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    const confirmedMessageId = selection?.messageId ?? messageId

    if (!selection?.value) {
      if (confirmedMessageId) await reply(ctx, { content: '❌ Descarte cancelado.', editMessageId: confirmedMessageId })
      return
    }

    const result = await CardsDB.discardUserCards(user.id, cardIds)
    if (!result.ok) {
      await reply(ctx, {
        content: `Você não possui mais o card \`${result.cardId}\` em quantidade suficiente. Nenhum card foi removido. Tente novamente.`,
        editMessageId: confirmedMessageId,
      })
      return
    }

    await reply(ctx, {
      content: `🗑 Coleção **${escapeMarkdown(args.subcategory.name)}** descartada (**${totalQty}** carta(s)). Você recebeu **${result.totalCoinsAwarded}** moedas.`,
      editMessageId: confirmedMessageId,
    })
  }
}
