import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB, InsufficientCardError } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { buildCtx } from '../../services/syntheticCtx'
import { resolveCardByIdOrName } from '../../services/commandArguments'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'
import { emitCardsNew } from '../../loaders/hooks'

const CONFIRM_EVENT = 'doar:confirm'
const MAX_CARDS = 50
const MAX_RECIPIENT_CARDS = 1500

export default class DoarCommand extends Command {
  static override info = {
    name: 'doar',
    description: 'Doa uma ou várias cartas para outro usuário',
    usage: '/doar <ID ou nome do usuário> <id ou nome do card> [id2 id3 ...] (ou * para doar tudo, ou em resposta ao usuário)',
    aliases: ['micar', 'imicae'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([
    { name: 'target', type: CommandArgumentType.USER_MENTION },
    { name: 'cardsRaw', type: CommandArgumentType.STRING, nullable: true },
  ])
  static override async execute(ctx: IncomingCommand, args: { target: string; cardsRaw?: string }) {
    if (!args.cardsRaw) {
      await reply(ctx, `Uso: \`${this.info.usage}\``)
      return
    }

    if (args.target === ctx.message.author.id) {
      await reply(ctx, 'Você não pode doar cartas para você mesmo! 😅')
      return
    }

    const platform = ctx.message.platform as 'telegram' | 'discord'
    const donor = await UsersDB.getUserByPlatformAccount(platform, ctx.message.author.id)
    if (!donor) return
    if (donor.isBanned) {
      await reply(ctx, 'Você está banido de usar a Giraê e não pode doar cartas.')
      return
    }

    const recipient = await UsersDB.getUserByPlatformAccount(platform, args.target)
    if (!recipient) {
      await reply(ctx, 'O usuário mencionado nunca usou a bot! Talvez você marcou a pessoa errada?')
      return
    }
    if (recipient.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode receber cartas.')
      return
    }

    let offerA: { cardId: number; count: number }[]
    let confirmContent: string
    let successList: string

    if (args.cardsRaw.trim() === '*') {
      const owned = await CardsDB.getAllOwnedCardIds(donor.id)
      if (owned.length === 0) {
        await reply(ctx, 'Você não tem nenhuma carta para doar.')
        return
      }
      offerA = owned.map(o => ({ cardId: o.cardId, count: o.count }))
      confirmContent = `Quer doar todos os seus cards (**${offerA.length}**) para **${escapeMarkdown(recipient.displayName)}**?`
      successList = ''
    } else {
      const tokens = args.cardsRaw.split(/\s+/).filter(Boolean)
      const requestedQty = new Map<number, number>()

      if (tokens.length === 1 || !tokens.every(t => /^\d+$/.test(t))) {
        const outcome = await resolveCardByIdOrName(args.cardsRaw)
        if (!outcome.ok) {
          await reply(ctx, outcome.message ?? `Uso: \`${this.info.usage}\``)
          return
        }
        requestedQty.set((outcome.value as { id: number }).id, 1)
      } else {
        if (tokens.length > MAX_CARDS) {
          await reply(ctx, `Você só pode doar até ${MAX_CARDS} cartas de uma vez.`)
          return
        }
        for (const t of tokens) {
          const id = parseInt(t, 10)
          requestedQty.set(id, (requestedQty.get(id) ?? 0) + 1)
        }
      }

      const owned = await CardsDB.getOwnedCardQuantities(donor.id, [...requestedQty.keys()])
      const ownedCountById = new Map(owned.map(o => [o.cardId, o.count]))

      const finalQty = new Map<number, number>()
      const skippedIds: number[] = []
      for (const [id, qty] of requestedQty) {
        const have = ownedCountById.get(id) ?? 0
        if (have >= qty) finalQty.set(id, qty)
        else skippedIds.push(id)
      }

      if (finalQty.size === 0) {
        await reply(ctx, 'Você não tem essas cartas em quantidade suficiente.')
        return
      }

      const validIds = [...finalQty.keys()]
      const cardDetails = await CardsDB.getCardsByIds(validIds)
      const cardsById = new Map(cardDetails.map(c => [c.id, c]))
      const list = validIds.map(id => {
        const c = cardsById.get(id)
        const qty = finalQty.get(id)!
        const qtySuffix = qty > 1 ? ` (\`${qty}x\`)` : ''
        return c ? `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**${qtySuffix}` : `\`${id}\`${qtySuffix}`
      }).join('\n')
      const skippedNote = skippedIds.length > 0 ? `\n\n⚠️ Ignoradas (você não tem em quantidade suficiente): ${skippedIds.map(id => `\`${id}\``).join(', ')}` : ''

      offerA = validIds.map(id => ({ cardId: id, count: finalQty.get(id)! }))
      const totalQty = offerA.reduce((sum, o) => sum + o.count, 0)
      confirmContent = `Doar **${totalQty}** carta(s) para **${escapeMarkdown(recipient.displayName)}**?\n\n${list}${skippedNote}`
      successList = `\n\n${list}`
    }

    await reply(ctx, {
      content: confirmContent,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) return


    const cardCount = offerA.reduce((sum, o) => sum + o.count, 0)
    let crossings: { userId: number; cardId: number; previousCount: number; newCount: number }[]
    try {
      const incomeInflationRate = await EconomyDB.getIncomeInflationRate()
      const result = await CardsDB.executeTrade(donor.id, offerA, recipient.id, [], incomeInflationRate)
      crossings = result.crossings
    } catch (e) {
      if (e instanceof InsufficientCardError) {
        await reply(ctx, 'Não foi possível completar a doação: você não tem mais uma das cartas selecionadas.')
      } else {
        await reply(ctx, `Não foi possível completar a doação: ${(e as Error).message}`)
      }
      return
    }

    await AuditDB.log(donor.id, 'card.doar', { recipientUserId: recipient.id, cards: offerA })

    const dm = buildCtx(platform, args.target, recipient.displayName, args.target)
    await reply(dm, `💱 ${mention(platform, ctx.message.author.id, donor.displayName)} te doou **${cardCount}** carta(s)!${successList}`)

    await reply(ctx, `💱 Pronto! **${cardCount}** carta(s) foram doadas para **${escapeMarkdown(recipient.displayName)}**.`)

    await emitCardsNew(recipient.id, args.target, recipient.displayName, platform, crossings.filter(c => c.userId === recipient.id))
  }
}
