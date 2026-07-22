import { Command } from '@girae/common/commands'
import { rawClient } from '@girae/common/queue'
import { reply } from '@girae/common/dbos/messaging'
import { DBOS } from '@dbos-inc/dbos-sdk'
import type { IncomingCommand } from '@girae/common/commands/types'
import GirarCommand from './girar.main'
import { INVITE_EVENT, FINALIZE_EVENT, NEGOTIATION_TOPIC } from './trade.cards'

export default class ClearCommand extends Command {
  static override info = {
    name: 'clear',
    description: 'Cancela giros pendentes.',
    usage: '/clear',
    aliases: ['cancel', 'cancelar']
  }

  static override async execute(ctx: IncomingCommand) {
    // must match girarClaim.ts's claimKey - was pointing at a dead namespace nothing wrote to
    const lockKey = `girar:active:${ctx.message.author.id}:${ctx.message.chat.id}`;
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
      return;
    }

    const tradeLockKey = `trade:lock:${ctx.message.author.id}`;
    const existingTradeLock = await rawClient.get(tradeLockKey);

    if (existingTradeLock) {
      const { workflowID, partnerId } = JSON.parse(existingTradeLock);

      await rawClient.del(tradeLockKey);
      if (partnerId) await rawClient.del(`trade:lock:${partnerId}`);

      if (workflowID) {
        await rawClient.del(`trade:state:${workflowID}`);
        await rawClient.del(`workflow:${workflowID}`);

        try {
          await DBOS.send(workflowID, { value: 'decline', clickerUserId: ctx.message.author.id }, INVITE_EVENT);
          await DBOS.send(workflowID, { value: 'cancel', clickerUserId: ctx.message.author.id }, FINALIZE_EVENT);
          await DBOS.send(workflowID, { type: 'stateChanged', clickerUserId: ctx.message.author.id }, NEGOTIATION_TOPIC);
        } catch (e) { }
      }

      await reply(ctx, "✅ Sua troca pendente foi cancelada com sucesso.");
      return;
    }

    await reply(ctx, "Você não tem nenhum giro ou troca pendente.");
  }
}
