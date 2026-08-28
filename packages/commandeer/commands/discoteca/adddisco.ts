import { Command } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { DiscotecaDB } from '@girae/database/discoteca'
import { modifyTradeOffer, getActiveTradeSide } from './tradedisco'
import type { IncomingCommand } from '@girae/common/commands/types'
import { resolveDiscotecaEntryByIdOrName } from '../../services/commandArguments'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const MAX_ENTRIES = 50

export default class AddDiscoCommand extends Command {
  static override info = {
    name: 'adddisco',
    description: 'Adiciona rapidamente um ou vários álbuns/singles à troca em andamento',
    usage: '/adddisco <nome ou ID> [ID2 ID3 ...]',
    aliases: ['adicionardisco'],
  }

  static override async execute(ctx: IncomingCommand) {
    const rawArgs = ctx.args.join(' ').trim()
    if (!rawArgs) {
      await reply(ctx, `Uso: \`${this.info.usage}\``)
      return
    }

    const tokens = rawArgs.split(/\s+/).filter(Boolean)

    if (tokens.length === 1 || !tokens.every(t => /^\d+$/.test(t))) {
      const outcome = await resolveDiscotecaEntryByIdOrName(rawArgs)
      if (!outcome.ok) {
        await reply(ctx, outcome.message ?? `Uso: \`${this.info.usage}\``)
        return
      }
      const entry = outcome.value as { id: number; name: string; artworkUrl: string | null }
      const message = await modifyTradeOffer(ctx.message.author.id, ctx.message.platform as 'telegram' | 'discord', entry.id, 'add')
      await reply(ctx, { content: message, photoUrl: entry.artworkUrl ?? undefined })
      return
    }

    if (tokens.length > MAX_ENTRIES) {
      await reply(ctx, `Você só pode adicionar até ${MAX_ENTRIES} itens de uma vez.`)
      return
    }

    const active = await getActiveTradeSide(ctx.message.author.id)
    if (!active) {
      await reply(ctx, 'Você não está em uma troca da Discoteca...')
      return
    }

    const ids = [...new Set(tokens.map(t => parseInt(t, 10)))]
    const entries = await DiscotecaDB.getEntriesByIds(ids)
    const entriesById = new Map(entries.map(e => [e.id, e]))

    const added: string[] = []
    const failed: string[] = []

    for (const id of ids) {
      const entry = entriesById.get(id)
      if (!entry) {
        failed.push(`\`${id}\`: não encontrei esse item.`)
        continue
      }
      const icon = entry.type === 'album' ? '💽' : '🎵'
      const message = await modifyTradeOffer(ctx.message.author.id, ctx.message.platform as 'telegram' | 'discord', id, 'add')
      if (message === 'Item adicionado.') added.push(`${icon} \`${entry.id}\`. **${escapeMarkdown(entry.name)}**`)
      else failed.push(`${icon} \`${entry.id}\`. **${escapeMarkdown(entry.name)}**: ${message}`)
    }

    const parts: string[] = []
    if (added.length > 0) parts.push(`✅ **Adicionados:**\n${added.join('\n')}`)
    if (failed.length > 0) parts.push(`❌ **Não foi possível adicionar:**\n${failed.join('\n')}`)
    await reply(ctx, parts.join('\n\n'))
  }
}
