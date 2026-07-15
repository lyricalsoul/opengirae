import { Command } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { editVanityItem } from '../../services/vanityWizard'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class EditStickerCommand extends Command {
  static override info = {
    name: 'editsticker',
    description: 'Edita um sticker existente (staff)',
    usage: '/editsticker <ID do item>',
    useWorkflow: true
  }

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    await editVanityItem(ctx, 'sticker')
  }
}
