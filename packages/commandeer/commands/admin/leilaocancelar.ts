import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { AuctionsDB } from '@girae/database/auctions'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../../constants'

export default class LeilaoCancelarCommand extends Command {
  static override info = {
    guards: ['isAdmin'],
    name: 'leilaocancelar',
    description: 'Cancela um leilão incondicionalmente, mesmo com lances - reembolso total dos dois lados (staff)',
    usage: '/leilaocancelar <ID do leilão>',
  }

  @CommandArgument([{ name: 'auctionId', type: CommandArgumentType.NUMBER, description: 'ID do leilão' }])
  static override async execute(ctx: IncomingCommand, args: { auctionId: number }) {
    const admin = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!admin) return

    const result = await AuctionsDB.cancelAuction(args.auctionId, admin.id, { asAdmin: true })
    if (!result.ok) { await reply(ctx, '🔍 Não encontrei um leilão ativo com esse ID.'); return }
    await reply(ctx, `❌ Leilão \`${args.auctionId}\` cancelado. ${EMOJI.auction} Card e moedas devolvidos por inteiro.`)
  }
}
