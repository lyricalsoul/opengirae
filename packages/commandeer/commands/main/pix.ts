import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { buildCtx } from '../../services/syntheticCtx'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'

const CONFIRM_EVENT = 'pix:confirm'
const MIN_AMOUNT = 1000

export default class PixCommand extends Command {
  static override info = {
    name: 'pix',
    description: 'Faz um pix de moedas para outro usuário',
    usage: '/pix <ID ou nome do usuário> <quantidade> (ou * para doar tudo, ou em resposta ao usuário)',
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([
    { name: 'target', type: CommandArgumentType.USER_MENTION },
    { name: 'amountRaw', type: CommandArgumentType.STRING, nullable: true },
  ])
  static override async execute(ctx: IncomingCommand, args: { target: string; amountRaw?: string }) {
    if (!args.amountRaw) {
      await reply(ctx, `Uso: \`${this.info.usage}\``)
      return
    }

    if (args.target === ctx.message.author.id) {
      await reply(ctx, 'Você não pode fazer pix para você mesmo! 😅')
      return
    }

    const platform = ctx.message.platform as 'telegram' | 'discord'
    const sender = await UsersDB.getUserByPlatformAccount(platform, ctx.message.author.id)
    if (!sender) return
    if (sender.isBanned) {
      await reply(ctx, 'Você está banido de usar a Giraê e não pode fazer pix.')
      return
    }

    const recipient = await UsersDB.getUserByPlatformAccount(platform, args.target)
    if (!recipient || recipient.isBanned) {
      await reply(ctx, '💳 Pix recusado, sem cocuxa hoje…')
      return
    }

    const trimmed = args.amountRaw.trim()
    let amount: number
    if (trimmed === '*') {
      amount = sender.coins
    } else {
      if (/^-?\d+\.\d+$/.test(trimmed)) {
        await reply(ctx, '📉 Pix cancelado! Será que tem dinheiro mesmo?')
        return
      }
      if (!/^-?\d+$/.test(trimmed)) {
        await reply(ctx, `Uso: \`${this.info.usage}\``)
        return
      }
      amount = parseInt(trimmed, 10)
    }

    if (amount < 0 || amount > sender.coins) {
      await reply(ctx, '💳 Pix recusado, sem cocuxa hoje…')
      return
    }
    if (amount < MIN_AMOUNT) {
      await reply(ctx, `🏦 Seu banco não autoriza pix menor que **${MIN_AMOUNT.toLocaleString('pt-BR')} moedas**`)
      return
    }

    const amountFormatted = amount.toLocaleString('pt-BR')
    await reply(ctx, {
      content: `Quer fazer o pix de **${amountFormatted}** para **${escapeMarkdown(recipient.displayName)}**?`,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    if (!confirmSelection?.value) {
      await reply(ctx, '📉 Pix cancelado! Será que tem dinheiro mesmo?')
      return
    }

    const ok = await UsersDB.transferCoins(sender.id, recipient.id, amount)
    if (!ok) {
      await reply(ctx, '💳 Pix recusado, sem cocuxa hoje…')
      return
    }

    await AuditDB.log(sender.id, 'coins.pix', { recipientUserId: recipient.id, amount })

    const dm = buildCtx(platform, args.target, recipient.displayName, args.target)
    await reply(dm, `💵 ${mention(platform, ctx.message.author.id, sender.displayName)} te fez um pix de **${amountFormatted}** moedas!`)

    await reply(ctx, `💵 Pronto! O pix no valor de **${amountFormatted}** foram depositadas na conta de **${escapeMarkdown(recipient.displayName)}**.`)
  }
}
