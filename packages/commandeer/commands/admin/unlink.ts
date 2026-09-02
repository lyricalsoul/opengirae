import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { UsersDB } from '@girae/database/users'
import { reply } from '@girae/common/dbos/messaging'
import { resolveStaffAndTarget } from '../../services/users/staffGrant'
import { invalidateCachedUserId } from '@girae/common/cache/users'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class UnlinkCommand extends Command {
  static override info = {
    guards: ['isAdmin'],
    name: 'unlink',
    description: 'Desfaz o /link mais recente de um usuário (staff)',
    usage: '/unlink <@usuário> (ou em resposta ao usuário)',
  }

  @CommandArgument([{ name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário' }])
  static override async execute(ctx: IncomingCommand, args: { target: string }) {
    const resolved = await resolveStaffAndTarget(ctx, args.target)
    if (!resolved) return
    const { staff, target } = resolved

    // undoLastMergeForUser writes its own 'users.unlink' audit_logs row (it needs the merge's
    // audit-log id regardless, to claim-lock it) - no separate AuditDB.log call here, unlike
    // /dar and /tirar, which mutate through *DB methods that don't log on their own.
    const result = await UsersDB.undoLastMergeForUser(target.id, staff.id)

    if (!result.ok) {
      await reply(ctx, result.reason === 'already_reverted'
        ? '❌ Esse link já tinha sido desfeito por outra pessoa.'
        : `😅 Não achei nenhum \`/link\` pendente pra desfazer em **${escapeMarkdown(target.displayName)}**.`)
      return
    }

    for (const acc of result.movedLinkedAccounts) {
      await invalidateCachedUserId(acc.platform as 'telegram' | 'discord', acc.platformId)
    }

    const lines = [
      `✅ Link desfeito! Separei uma conta nova (ID \`${result.newSecondaryUserId}\`) de **${escapeMarkdown(target.displayName)}**.`,
    ]

    if (result.coinsShortfall > 0) {
      lines.push(`⚠️ Só consegui devolver **${result.coinsReturned}** de **${result.coinsReturned + result.coinsShortfall}** moedas — o resto já tinha sido gasto por **${escapeMarkdown(target.displayName)}**.`)
    }
    if (result.reputationShortfall > 0) {
      lines.push(`⚠️ Reputação: só consegui devolver ${result.reputationReturned} de ${result.reputationReturned + result.reputationShortfall}.`)
    }
    for (const cs of result.cardShortfalls) {
      lines.push(`⚠️ Card \`${cs.cardId}\`: só consegui devolver ${cs.returned}/${cs.requested} cópia(s) — o resto já não estava mais na conta.`)
    }
    if (result.failedMarriages > 0) {
      lines.push(`⚠️ Não consegui restaurar ${result.failedMarriages === 1 ? 'um casamento antigo' : `${result.failedMarriages} casamentos antigos`} — o(a) parceiro(a) já tinha casado de novo.`)
    }

    await reply(ctx, lines.join('\n'))
  }
}
