import { Command } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { deleteVanityItem } from '../../services/vanityWizard'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class DeleteStickerCommand extends Command {
  static override info = {
    name: 'delsticker',
    description: 'Deleta um sticker (staff)',
    usage: '/delsticker <ID do item>',
    useWorkflow: true
  }

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    await deleteVanityItem(ctx, 'sticker')
  }
}
