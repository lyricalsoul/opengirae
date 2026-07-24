import { Command } from '@girae/common/commands'
import type { IncomingCommand } from '@girae/common/commands/types'
import { togglePrivacyMode } from '../../services/users/privacyToggle'

export default class PrivacyCommand extends Command {
  static override info = {
    name: 'privacy',
    description: 'Ativa ou desativa o modo privado (esconde seu perfil, cards e lista de desejos de outros usuários)',
    usage: '/privacy',
    aliases: ['privacidade'],
  }

  static override async execute(ctx: IncomingCommand) {
    await togglePrivacyMode(ctx)
  }
}
