import { Command } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { addVanityItem } from '../../services/vanityWizard'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class AddStickerCommand extends Command {
  static override info = {
    name: 'addsticker',
    description: 'Adiciona um sticker de perfil (staff)',
    usage: '/addsticker <preço> Nome - Descrição',
    useWorkflow: true
  }

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    await addVanityItem(ctx, 'sticker')
  }
}
