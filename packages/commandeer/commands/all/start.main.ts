import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply } from '@girae/common/dbos/messaging'
import { rawClient } from '@girae/common/queue'
import type { IncomingCommand } from '@girae/common/commands/types'
import { NEGOTIATION_TOPIC } from './trade.cards'

export default class StartCommand extends Command {
  static override info = {
    name: 'start',
    description: 'Abre uma conversa privada com a bot',
  }

  @CommandArgument([{ name: 'payload', type: CommandArgumentType.STRING, nullable: true, description: 'Parâmetro de inicialização' }])
  static override async execute(ctx: IncomingCommand, args: { payload?: string }) {
    const payload = args.payload
    if (!payload) {
      await reply(ctx, `🎉 Boas-vindas à Giraê!\n\n🕹 Digite / para ver meus comandos. O mais importante é, obviamente, o /girar.\n\n📢 Para usar a bot, entre no nosso canal @undergirae [clicando aqui](https://t.me/undergirae).`)
      return
    }

    if (payload === 'trade') {
      const lockKey = `trade:lock:${ctx.message.author.id}`
      const raw = await rawClient.get(lockKey)
      if (!raw) {
        await reply(ctx, 'Essa troca não existe mais! 😅\nRealize-a novamente.')
        return
      }

      const { workflowID } = JSON.parse(raw)
      await DBOS.send(workflowID, {
        type: 'dmOpened',
        clickerUserId: ctx.message.author.id,
        chatId: ctx.message.chat.id,
      }, NEGOTIATION_TOPIC)
      return
    }
  }
}
