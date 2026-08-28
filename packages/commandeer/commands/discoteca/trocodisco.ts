import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { DiscotecaDB } from '@girae/database/discoteca'
import { resolveDiscotecaEntryByIdOrName } from '../../services/commandArguments'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const MAX_ENTRIES = 50

export default class TrocoDiscoCommand extends Command {
  static override info = {
    name: 'trocodisco',
    description: 'Marca um ou vários álbuns/singles como trocáveis',
    usage: '/trocodisco <id ou nome> [id2 id3 ...]',
  }

  @CommandArgument([{ name: 'entriesRaw', type: CommandArgumentType.STRING, description: 'ID(s) ou nome do álbum/single' }])
  static override async execute(ctx: IncomingCommand, args: { entriesRaw: string }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const tokens = args.entriesRaw.split(/\s+/).filter(Boolean)

    if (tokens.length === 1 || !tokens.every(t => /^\d+$/.test(t))) {
      const outcome = await resolveDiscotecaEntryByIdOrName(args.entriesRaw)
      if (!outcome.ok) {
        await reply(ctx, outcome.message ?? `Uso: \`${this.info.usage}\``)
        return
      }
      const entry = outcome.value as { id: number; name: string }
      const owned = await DiscotecaDB.getUserDiscoteca(user.id, entry.id)
      if (!owned || owned.count < 1) {
        await reply(ctx, '😂 Troca o que? Você não tem esse item.')
        return
      }
      await DiscotecaDB.setEntryTradable(user.id, entry.id, true)
      await reply(ctx, `🔄 **${escapeMarkdown(entry.name)}** agora está marcado como trocável.`)
      return
    }

    if (tokens.length > MAX_ENTRIES) {
      await reply(ctx, `Você só pode marcar até ${MAX_ENTRIES} itens de uma vez.`)
      return
    }

    const uniqueIds = [...new Set(tokens.map(t => parseInt(t, 10)))]
    const owned = await DiscotecaDB.getOwnedEntryQuantities(user.id, uniqueIds)
    const ownedIds = new Set(owned.map(o => o.entryId))

    const validIds = uniqueIds.filter(id => ownedIds.has(id))
    const skippedIds = uniqueIds.filter(id => !ownedIds.has(id))

    if (validIds.length === 0) {
      await reply(ctx, '😂 Troca o que? Você não tem nenhum desses itens.')
      return
    }

    const entries = await DiscotecaDB.getEntriesByIds(validIds)
    const entriesById = new Map(entries.map(e => [e.id, e]))
    for (const id of validIds) await DiscotecaDB.setEntryTradable(user.id, id, true)

    const list = validIds.map(id => {
      const e = entriesById.get(id)
      if (!e) return `\`${id}\``
      const icon = e.type === 'album' ? '💽' : '🎵'
      return `${icon} \`${e.id}\`. **${escapeMarkdown(e.name)}**`
    }).join('\n')
    const skippedNote = skippedIds.length > 0 ? `\n\n⚠️ Ignorados (você não tem): ${skippedIds.map(id => `\`${id}\``).join(', ')}` : ''

    await reply(ctx, `🔄 **Marcados como trocáveis:**\n${list}${skippedNote}`)
  }
}
