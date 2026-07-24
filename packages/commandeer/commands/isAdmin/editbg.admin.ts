import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { editVanityItem } from '../../services/vanity/vanityWizard'
import { VanitiesDB } from '@girae/database/vanities'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class EditBackgroundCommand extends Command {
  static override info = {
    name: 'editbg',
    description: 'Edita um papel de parede existente (staff)',
    usage: '/editbg <ID do item>',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'item', type: CommandArgumentType.VANITY_ITEM, vanityType: 'background', showBasePrice: true }])
  static override async execute(ctx: IncomingCommand, args: { item: NonNullable<Awaited<ReturnType<typeof VanitiesDB.getStoreItemById>>> }) {
    await editVanityItem(ctx, 'background', args.item)
  }
}
