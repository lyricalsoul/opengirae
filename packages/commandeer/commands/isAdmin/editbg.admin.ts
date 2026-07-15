import { Command } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { editVanityItem } from '../../services/vanityWizard'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class EditBackgroundCommand extends Command {
  static override info = {
    name: 'editbg',
    description: 'Edita um papel de parede existente (staff)',
    usage: '/editbg <ID do item>',
    useWorkflow: true
  }

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    await editVanityItem(ctx, 'background')
  }
}
