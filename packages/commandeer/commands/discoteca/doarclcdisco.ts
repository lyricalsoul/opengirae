import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { DiscotecaDB, InsufficientDiscotecaEntryError } from '@girae/database/discoteca'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { resolveDonationParties, confirmByAuthor, reportTransferFailure } from '../../services/donations/shared'
import { buildCtx } from '../../services/syntheticCtx'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'

const CONFIRM_EVENT = 'doarclcdisco:confirm'
const CONFIRM_LIST_LIMIT = 20

// caps a rendered entry list so messages can't blow past Telegram's ~4096 char limit
function renderEntryList(lines: string[]): string {
  if (lines.length <= CONFIRM_LIST_LIMIT) return lines.join('\n');
  return `${lines.slice(0, CONFIRM_LIST_LIMIT).join('\n')}\n…e mais ${lines.length - CONFIRM_LIST_LIMIT}`;
}

export default class DoarClcDiscoCommand extends Command {
  static override info = {
    name: 'doarclcdisco',
    description: 'Doa todos os álbuns/singles que você tem de um artista para outro usuário',
    usage: '/doarclcdisco <ID ou nome do usuário> <nome ou ID do artista> (ou em resposta ao usuário)',
    aliases: ['doarartistadisco'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([
    { name: 'target', type: CommandArgumentType.USER_MENTION },
    { name: 'artist', type: CommandArgumentType.DISCOTECA_ARTIST },
  ])
  static override async execute(ctx: IncomingCommand, args: { target: string; artist: NonNullable<Awaited<ReturnType<typeof DiscotecaDB.getArtist>>> }) {
    const parties = await resolveDonationParties(ctx, args.target, 'itens')
    if (!parties) return
    const { platform, donor, recipient } = parties

    const artistEntries = await DiscotecaDB.getEntriesForArtist(args.artist.id, donor.id)
    const owned = artistEntries.filter(e => e.ownedCount > 0)
    if (owned.length === 0) {
      await reply(ctx, `Você não tem nenhum álbum/single de **${escapeMarkdown(args.artist.name)}** para doar.`)
      return
    }

    const offerA = owned.map(e => ({ entryId: e.id, count: e.ownedCount }))
    const totalQty = offerA.reduce((sum, o) => sum + o.count, 0)
    const list = renderEntryList(owned.map(e => {
      const qtySuffix = e.ownedCount > 1 ? ` (\`${e.ownedCount}x\`)` : ''
      const icon = e.type === 'album' ? '💽' : '🎵'
      return `${icon} \`${e.id}\`. **${escapeMarkdown(e.name)}**${qtySuffix}`
    }))

    const confirmContent = `Doar toda a sua discografia de **${escapeMarkdown(args.artist.name)}** (**${totalQty}** item(ns)) para **${escapeMarkdown(recipient.displayName)}**?\n\n${list}`

    if (!(await confirmByAuthor(ctx, CONFIRM_EVENT, confirmContent))) return

    try {
      await DiscotecaDB.executeDonation(donor.id, offerA, recipient.id)
    } catch (e) {
      if (e instanceof InsufficientDiscotecaEntryError) {
        await reply(ctx, 'Não foi possível completar a doação: você não tem mais um dos itens selecionados.')
      } else {
        await reportTransferFailure(ctx, 'doarclcdisco', 'doação', e)
      }
      return
    }

    await AuditDB.log(donor.id, 'discoteca.doarclc', { recipientUserId: recipient.id, artistId: args.artist.id, entries: offerA })

    const dm = buildCtx(platform, args.target, recipient.displayName, args.target)
    await reply(dm, `💱 ${mention(platform, ctx.message.author.id, donor.displayName)} te doou toda a discografia de **${escapeMarkdown(args.artist.name)}** (**${totalQty}** item(ns))!\n\n${list}`)

    await reply(ctx, `💱 Pronto! Sua discografia de **${escapeMarkdown(args.artist.name)}** (**${totalQty}** item(ns)) foi doada para **${escapeMarkdown(recipient.displayName)}**.`)
  }
}
