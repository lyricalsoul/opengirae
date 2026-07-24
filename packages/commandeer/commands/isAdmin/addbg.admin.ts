import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { addVanityItem } from '../../services/vanity/vanityWizard'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class AddBackgroundCommand extends Command {
  static override info = {
    name: 'addbg',
    description: 'Adiciona um papel de parede de perfil (staff)',
    usage: '/addbg [preço] [Nome - Descrição]',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'content', type: CommandArgumentType.STRING, nullable: true }])
  static override async execute(ctx: IncomingCommand, args: { content?: string }) {
    await addVanityItem(ctx, 'background', args.content)
  }
}
