import { Command } from '@girae/common/commands'
import { rawClient } from '@girae/common/queue'
import { reply } from '@girae/common/dbos/messaging'
import { DBOS } from '@dbos-inc/dbos-sdk'
import type { IncomingCommand } from '@girae/common/commands/types'
import GirarCommand from './girar.main'

export default class ClearCommand extends Command {
  static override info = {
    name: 'clear',
    description: 'Cancela giros pendentes.',
    usage: '/clear',
    aliases: ['cancel', 'cancelar']
  }

  static override async execute(ctx: IncomingCommand) {
    const lockKey = `girar:lock:${ctx.message.author.id}`;
    const existingLock = await rawClient.get(lockKey);

    if (existingLock) {
      const lockData = JSON.parse(existingLock);
      const workflowID = lockData.workflowID;

      await rawClient.del(lockKey);

      if (workflowID) {
        await rawClient.del(`workflow:${workflowID}`);

        try {
          await DBOS.send(workflowID, { value: null }, GirarCommand.CATEGORY_SELECTED_EVENT);
          await DBOS.send(workflowID, { value: null }, GirarCommand.SUBCATEGORY_SELECTED_EVENT);
        } catch (e) { }
      }

      await reply(ctx, "✅ Seu giro pendente foi cancelado com sucesso.");
    } else {
      await reply(ctx, "Você não tem nenhum giro pendente.");
    }
  }
}
