import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { resolveStaffAndTarget } from '../../services/users/staffGrant'
import { guards } from '../../services/guards'
import { invalidateCachedUserId } from '@girae/common/cache/users'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import type { IncomingCommand } from '@girae/common/commands/types'

type Mode = 'after' | 'before'

export default class UnlinkCommand extends Command {
  static override info = {
    guards: ['isAdmin'],
    name: 'unlink',
    description: 'Desfaz o /link mais recente de um usuário (staff)',
    usage: '/unlink <@usuário> (ou em resposta ao usuário)',
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário' }])
  static override async execute(ctx: IncomingCommand, args: { target: string }) {
    const resolved = await resolveStaffAndTarget(ctx, args.target)
    if (!resolved) return
    const { staff, target } = resolved

    await reply(ctx, {
      content: `Desfazer o link de **${escapeMarkdown(target.displayName)}** de que jeito?\n\n📜 **Depois da atualização**: o \`/link\` tem um snapshot registrado, dá pra desfazer com precisão (devolve moedas/cards até o limite do que a conta principal ainda tiver).\n🔓 **Antes da atualização**: não tem snapshot, não dá pra saber a divisão certa — a conta que você mencionou fica com tudo que a conta principal já tem hoje, e toda outra conta de plataforma fundida junto vira uma conta nova, vazia.`,
      eventName: 'unlink:mode',
      restricted: 'author',
      options: [
        { title: '📜 Depois da atualização', data: 'after' as Mode },
        { title: '🔓 Antes da atualização', data: 'before' as Mode },
      ],
    })

    const modeSelection = await DBOS.recv<{ value: Mode, messageId?: string }>('unlink:mode')
    if (modeSelection?.messageId) await deleteMsg(ctx, modeSelection.messageId)
    if (!modeSelection) return

    if (modeSelection.value === 'before') {
      await runUnlinkAllExcept(ctx, staff, target, args.target)
      return
    }

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

// No audit snapshot to clamp against here, so it hands the full pot to one party - staffGroupOnly-gated since there's no shortfall safety net like the "depois" path has.
async function runUnlinkAllExcept(
  ctx: IncomingCommand,
  staff: NonNullable<Awaited<ReturnType<typeof UsersDB.getUserByPlatformAccount>>>,
  target: NonNullable<Awaited<ReturnType<typeof UsersDB.getUserByPlatformAccount>>>,
  targetPlatformId: string,
) {
  if (!(await guards.staffGroupOnly!(ctx))) {
    await reply(ctx, '🔒 Essa opção só pode ser usada no grupo da staff — ela entrega tudo da conta fundida pra uma só pessoa, sem jeito de desfazer depois.')
    return
  }

  const platform = ctx.message.platform as 'telegram' | 'discord'
  const result = await UsersDB.unlinkAllExcept(platform, targetPlatformId)

  if (!result.ok) {
    await reply(ctx, 'Não encontrei esse usuário. Ele já usou a bot?')
    return
  }

  for (const acc of result.separatedAccounts) {
    await invalidateCachedUserId(acc.platform as 'telegram' | 'discord', acc.platformId)
  }

  await AuditDB.log(staff.id, 'users.unlinkAllExcept', {
    mainUserId: result.mainUserId,
    keptPlatform: platform,
    keptPlatformId: targetPlatformId,
    separatedAccounts: result.separatedAccounts,
  })

  if (result.separatedAccounts.length === 0) {
    await reply(ctx, `**${escapeMarkdown(target.displayName)}** não tinha nenhuma outra conta fundida — nada pra separar.`)
    return
  }

  const accountsList = result.separatedAccounts.map(a => `${a.platform === 'discord' ? '🎮' : '✈️'} \`${a.platformId}\` → novo ID \`${a.newUserId}\``).join('\n')
  await reply(ctx, `✅ **${escapeMarkdown(target.displayName)}** (ID \`${result.mainUserId}\`) ficou com tudo. Separei ${result.separatedAccounts.length === 1 ? 'a outra conta' : `as outras ${result.separatedAccounts.length} contas`} fundida(s), agora vazia(s):\n\n${accountsList}`)
}
