import { Command } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { AuditDB } from '@girae/database/audit'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'

const CONFIRM_EVENT = 'updategirae:confirm'

function isNearHourBoundary(now: Date): boolean {
  const minutes = now.getMinutes()
  return minutes >= 55 || minutes < 5
}

export default class UpdateGiraeCommand extends Command {
  static override info = {
    name: 'updategirae',
    description: 'Atualiza o ambiente de produção da Girae (staff)',
    usage: '/updategirae',
    useWorkflow: true
  }

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    const webhookUrl = process.env.DOKPLOY_PROD_WEBHOOK_URL
    if (!webhookUrl) return

    if (isNearHourBoundary(new Date())) {
      await reply(ctx, '❌ Espere a distribuição de giros da hora antes de atualizar.')
      return
    }

    await reply(ctx, {
      content: '⚠️ **Atenção!** Confira se a bot e as novas funções estão funcionando normalmente antes de atualizar a versão de produção da Giraê!',
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true, color: 'success' }, { title: '❌ Cancelar', data: false, color: 'danger' }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) return

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (user) await AuditDB.log(user.id, 'girae.update', {})

    await fetch(webhookUrl, { method: 'POST' })
    await reply(ctx, '✅ Aguarde enquanto o ambiente de prod é atualizado.')
  }
}
