import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { editVanityItem } from '../../services/vanityWizard'
import { VanitiesDB } from '@girae/database/vanities'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class EditStickerCommand extends Command {
  static override info = {
    name: 'editsticker',
    description: 'Edita um sticker existente (staff)',
    usage: '/editsticker <ID do item>',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'item', type: CommandArgumentType.VANITY_ITEM, vanityType: 'sticker' }])
  static override async execute(ctx: IncomingCommand, args: { item: NonNullable<Awaited<ReturnType<typeof VanitiesDB.getStoreItemById>>> }) {
    await editVanityItem(ctx, 'sticker', args.item)
  }
}
