import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { DiscotecaDB, InsufficientDiscotecaEntryError } from '@girae/database/discoteca'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { buildCtx } from '../../services/syntheticCtx'
import { resolveDiscotecaEntryByIdOrName } from '../../services/commandArguments'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'

const CONFIRM_EVENT = 'doardisco:confirm'
const MAX_ENTRIES = 50

export default class DoarDiscoCommand extends Command {
  static override info = {
    name: 'doardisco',
    description: 'Doa um ou vários álbuns/singles para outro usuário',
    usage: '/doardisco <ID ou nome do usuário> <id ou nome do item> [id2 id3 ...] (ou * para doar tudo, ou em resposta ao usuário)',
    aliases: ['micardisco'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([
    { name: 'target', type: CommandArgumentType.USER_MENTION },
    { name: 'entriesRaw', type: CommandArgumentType.STRING, nullable: true },
  ])
  static override async execute(ctx: IncomingCommand, args: { target: string; entriesRaw?: string }) {
    if (!args.entriesRaw) {
      await reply(ctx, `Uso: \`${this.info.usage}\``)
      return
    }

    if (args.target === ctx.message.author.id) {
      await reply(ctx, 'Você não pode doar itens para você mesmo! 😅')
      return
    }

    const platform = ctx.message.platform as 'telegram' | 'discord'
    const donor = await UsersDB.getUserByPlatformAccount(platform, ctx.message.author.id)
    if (!donor) return
    if (donor.isBanned) {
      await reply(ctx, 'Você está banido de usar a Giraê e não pode doar itens.')
      return
    }

    const recipient = await UsersDB.getUserByPlatformAccount(platform, args.target)
    if (!recipient) {
      await reply(ctx, 'O usuário mencionado nunca usou a bot! Talvez você marcou a pessoa errada?')
      return
    }
    if (recipient.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode receber itens.')
      return
    }

    let offerA: { entryId: number; count: number }[]
    let confirmContent: string
    let successList: string

    if (args.entriesRaw.trim() === '*') {
      const owned = await DiscotecaDB.getAllOwnedEntryIds(donor.id)
      if (owned.length === 0) {
        await reply(ctx, 'Você não tem nenhum álbum/single para doar.')
        return
      }
      offerA = owned.map(o => ({ entryId: o.entryId, count: o.count }))
      confirmContent = `Quer doar todos os seus álbuns/singles (**${offerA.length}**) para **${escapeMarkdown(recipient.displayName)}**?`
      successList = ''
    } else {
      const tokens = args.entriesRaw.split(/\s+/).filter(Boolean)
      const requestedQty = new Map<number, number>()

      if (tokens.length === 1 || !tokens.every(t => /^\d+$/.test(t))) {
        const outcome = await resolveDiscotecaEntryByIdOrName(args.entriesRaw)
        if (!outcome.ok) {
          await reply(ctx, outcome.message ?? `Uso: \`${this.info.usage}\``)
          return
        }
        requestedQty.set((outcome.value as { id: number }).id, 1)
      } else {
        if (tokens.length > MAX_ENTRIES) {
          await reply(ctx, `Você só pode doar até ${MAX_ENTRIES} itens de uma vez.`)
          return
        }
        for (const t of tokens) {
          const id = parseInt(t, 10)
          requestedQty.set(id, (requestedQty.get(id) ?? 0) + 1)
        }
      }

      const owned = await DiscotecaDB.getOwnedEntryQuantities(donor.id, [...requestedQty.keys()])
      const ownedCountById = new Map(owned.map(o => [o.entryId, o.count]))

      const finalQty = new Map<number, number>()
      const skippedIds: number[] = []
      for (const [id, qty] of requestedQty) {
        const have = ownedCountById.get(id) ?? 0
        if (have >= qty) finalQty.set(id, qty)
        else skippedIds.push(id)
      }

      if (finalQty.size === 0) {
        await reply(ctx, 'Você não tem esses itens em quantidade suficiente.')
        return
      }

      const validIds = [...finalQty.keys()]
      const entryDetails = await DiscotecaDB.getEntriesByIds(validIds)
      const entriesById = new Map(entryDetails.map(e => [e.id, e]))
      const list = validIds.map(id => {
        const e = entriesById.get(id)
        const qty = finalQty.get(id)!
        const qtySuffix = qty > 1 ? ` (\`${qty}x\`)` : ''
        const icon = e?.type === 'album' ? '💽' : '🎵'
        return e ? `${icon} \`${e.id}\`. **${escapeMarkdown(e.name)}**${qtySuffix}` : `\`${id}\`${qtySuffix}`
      }).join('\n')
      const skippedNote = skippedIds.length > 0 ? `\n\n⚠️ Ignorados (você não tem em quantidade suficiente): ${skippedIds.map(id => `\`${id}\``).join(', ')}` : ''

      offerA = validIds.map(id => ({ entryId: id, count: finalQty.get(id)! }))
      const totalQty = offerA.reduce((sum, o) => sum + o.count, 0)
      confirmContent = `Doar **${totalQty}** item(ns) para **${escapeMarkdown(recipient.displayName)}**?\n\n${list}${skippedNote}`
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

    const entryCount = offerA.reduce((sum, o) => sum + o.count, 0)
    try {
      await DiscotecaDB.executeDonation(donor.id, offerA, recipient.id)
    } catch (e) {
      if (e instanceof InsufficientDiscotecaEntryError) {
        await reply(ctx, 'Não foi possível completar a doação: você não tem mais um dos itens selecionados.')
      } else {
        await reply(ctx, `Não foi possível completar a doação: ${(e as Error).message}`)
      }
      return
    }

    await AuditDB.log(donor.id, 'discoteca.doar', { recipientUserId: recipient.id, entries: offerA })

    const dm = buildCtx(platform, args.target, recipient.displayName, args.target)
    await reply(dm, `💱 ${mention(platform, ctx.message.author.id, donor.displayName)} te doou **${entryCount}** item(ns) da Discoteca!${successList}`)

    await reply(ctx, `💱 Pronto! **${entryCount}** item(ns) foram doados para **${escapeMarkdown(recipient.displayName)}**.`)
  }
}
