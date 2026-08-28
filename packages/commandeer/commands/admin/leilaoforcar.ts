import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { AuctionsDB } from '@girae/database/auctions'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../../constants'

export default class LeilaoForcarCommand extends Command {
  static override info = {
    guards: ['isAdmin'],
    name: 'leilaoforcar',
    description: 'Força o fecho de um leilão agora, como se o tempo tivesse acabado (staff)',
    usage: '/leilaoforcar <ID do leilão>',
  }

  @CommandArgument([{ name: 'auctionId', type: CommandArgumentType.NUMBER, description: 'ID do leilão' }])
  static override async execute(ctx: IncomingCommand, args: { auctionId: number }) {
    const result = await AuctionsDB.forceCloseAuction(args.auctionId)
    if (!result.ok) { await reply(ctx, '🔍 Não encontrei um leilão ativo com esse ID.'); return }
    await reply(ctx, `${EMOJI.auction} Leilão \`${args.auctionId}\` fechado à força. Estado final: **${result.auction.status}**.`)
  }
}
