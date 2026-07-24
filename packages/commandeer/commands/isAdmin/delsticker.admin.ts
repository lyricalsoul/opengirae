import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { deleteVanityItem } from '../../services/vanityWizard'
import { VanitiesDB } from '@girae/database/vanities'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class DeleteStickerCommand extends Command {
  static override info = {
    name: 'delsticker',
    description: 'Deleta um sticker (staff)',
    usage: '/delsticker <ID do item>',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'item', type: CommandArgumentType.VANITY_ITEM, vanityType: 'sticker', showBasePrice: true }])
  static override async execute(ctx: IncomingCommand, args: { item: NonNullable<Awaited<ReturnType<typeof VanitiesDB.getStoreItemById>>> }) {
    await deleteVanityItem(ctx, 'sticker', args.item)
  }
}
