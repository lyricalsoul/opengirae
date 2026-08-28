import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { DiscotecaDB } from '@girae/database/discoteca'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import { calculateCardDiscardReward } from '@girae/database/constants'
import { reply } from '@girae/common/dbos/messaging'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'venderdisco:confirm'
const MAX_ENTRIES_PER_REQUEST = 50

export default class VenderDiscoCommand extends Command {
  static override info = {
    name: 'venderdisco',
    description: 'Vende um ou mais álbuns/singles em troca de moedas',
    usage: '/venderdisco <ID> [ID2] [ID3] ...',
    aliases: ['deletardisco', 'deldisco'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'ids', type: CommandArgumentType.STRING, description: 'IDs dos itens separados por espaço' }])
  static override async execute(ctx: IncomingCommand, args: { ids: string }) {
    const tokens = args.ids.split(/\s+/).filter(Boolean)

    if (tokens.length > MAX_ENTRIES_PER_REQUEST) {
      await reply(ctx, `Você só pode vender até ${MAX_ENTRIES_PER_REQUEST} itens de uma vez.`)
      return
    }

    const entryIds: number[] = []
    for (const token of tokens) {
      if (!/^\d+$/.test(token)) {
        await reply(ctx, `\`${escapeMarkdown(token)}\` não é um ID válido. Nada foi removido.`)
        return
      }
      entryIds.push(parseInt(token, 10))
    }

    const requestedQty = new Map<number, number>()
    for (const id of entryIds) requestedQty.set(id, (requestedQty.get(id) ?? 0) + 1)

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const owned = await DiscotecaDB.getOwnedEntryQuantities(user.id, [...requestedQty.keys()])
    const ownedCountById = new Map(owned.map(o => [o.entryId, o.count]))

    const finalIds: number[] = []
    for (const [entryId, qty] of requestedQty) {
      const have = ownedCountById.get(entryId) ?? 0
      if (have >= qty) {
        for (let i = 0; i < qty; i++) finalIds.push(entryId)
      }
    }

    if (finalIds.length === 0) {
      await reply(ctx, 'Você não possui esses álbuns/singles em quantidade suficiente.')
      return
    }

    const finalQty = new Map<number, number>()
    for (const id of finalIds) finalQty.set(id, (finalQty.get(id) ?? 0) + 1)
    const uniqueFinalIds = [...finalQty.keys()]

    const entries = await DiscotecaDB.getEntriesByIds(uniqueFinalIds)
    const entriesById = new Map(entries.map(e => [e.id, e]))

    const incomeInflationRate = await EconomyDB.getIncomeInflationRate()
    const estimatedTotal = uniqueFinalIds.reduce((sum, id) => {
      const entry = entriesById.get(id)
      const qty = finalQty.get(id)!
      return sum + (entry ? calculateCardDiscardReward(entry.rarityName, qty, incomeInflationRate) : 0)
    }, 0)
    const list = uniqueFinalIds.map(id => {
      const entry = entriesById.get(id)!
      const qty = finalQty.get(id)!
      const icon = entry.type === 'album' ? '💽' : '🎵'
      return `${icon} \`${entry.id}\`. **${escapeMarkdown(entry.name)}**${qty > 1 ? ` (\`${qty}x\`)` : ''}`
    }).join('\n')

    const messageId = await reply(ctx, {
      content: `🗑 Vender ${finalIds.length > 1 ? `${finalIds.length} itens` : 'este item'}?\n\n${list}\n\nVocê receberá **~${estimatedTotal}** moedas. Essa ação não pode ser desfeita.`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const selection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    const confirmedMessageId = selection?.messageId ?? messageId

    if (!selection?.value) {
      if (confirmedMessageId) await reply(ctx, { content: '❌ Venda cancelada.', editMessageId: confirmedMessageId })
      return
    }

    const result = await DiscotecaDB.sellUserDiscoteca(user.id, finalIds)
    if (!result.ok) {
      await reply(ctx, {
        content: `Você não possui mais o item \`${result.entryId}\` em quantidade suficiente. Nada foi removido.`,
        editMessageId: confirmedMessageId,
      })
      return
    }

    await reply(ctx, {
      content: `🗑 ${finalIds.length > 1 ? `${finalIds.length} itens vendidos` : 'Item vendido'}. Você recebeu **${result.totalCoinsAwarded}** moedas.`,
      editMessageId: confirmedMessageId,
    })
  }
}
