import { Command, Subcommand, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { buildCtx } from '../../services/syntheticCtx'
import { resolveStaffAndTarget } from '../../services/users/staffGrant'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class TirarCommand extends Command {
  static override info = {
    guards: ['isAdmin', 'staffGroupOnly'],
    name: 'tirar',
    description: 'Tira moedas, giros ou cards de um usuário (staff, só no grupo da staff)',
    usage: '/tirar <moedas|giros|card> <quantidade> [ID do card] <@usuário> (ou em resposta ao usuário)',
    aliases: ['take'],
  }

  static override async execute(ctx: IncomingCommand) {
    await reply(ctx, `Uso: \`${this.info.usage}\``)
  }

  @Subcommand({ name: 'moedas', description: 'Tira moedas de um usuário', aliases: ['coins'] })
  @CommandArgument([
    { name: 'amount', type: CommandArgumentType.NUMBER, description: 'Quantidade de moedas' },
    { name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário' },
  ])
  static async takeCoins(ctx: IncomingCommand, args: { amount: number; target: string }) {
    if (args.amount <= 0) { await reply(ctx, '💸 A quantidade tem que ser maior que zero.'); return }

    const resolved = await resolveStaffAndTarget(ctx, args.target)
    if (!resolved) return
    const { staff, target } = resolved

    const ok = await UsersDB.removeCoins(target.id, args.amount)
    if (!ok) {
      await reply(ctx, `😅 **${escapeMarkdown(target.displayName)}** não tem **${args.amount}** moedas pra tirar.`)
      return
    }

    await AuditDB.log(staff.id, 'coins.confiscate', { targetUserId: target.id, amount: args.amount })

    const dm = buildCtx(ctx.message.platform, args.target, target.displayName, args.target)
    await reply(dm, `💸 A staff tirou **${args.amount}** moedas da sua conta.`)

    await reply(ctx, `💸 Pronto! **${args.amount}** moedas foram tiradas de **${escapeMarkdown(target.displayName)}**.`)
  }

  @Subcommand({ name: 'giros', description: 'Tira giros de um usuário', aliases: ['spins'] })
  @CommandArgument([
    { name: 'amount', type: CommandArgumentType.NUMBER, description: 'Quantidade de giros' },
    { name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário' },
  ])
  static async takeGiros(ctx: IncomingCommand, args: { amount: number; target: string }) {
    if (args.amount <= 0) { await reply(ctx, '🎲 A quantidade tem que ser maior que zero.'); return }

    const resolved = await resolveStaffAndTarget(ctx, args.target)
    if (!resolved) return
    const { staff, target } = resolved

    await UsersDB.takeTemporaryDraws(target.id, args.amount)
    await AuditDB.log(staff.id, 'draws.confiscate', { targetUserId: target.id, amount: args.amount })

    const dm = buildCtx(ctx.message.platform, args.target, target.displayName, args.target)
    await reply(dm, `🎲 A staff tirou **${args.amount}** giros de você.`)

    await reply(ctx, `🎲 Pronto! **${args.amount}** giros foram tirados de **${escapeMarkdown(target.displayName)}**.`)
  }

  @Subcommand({ name: 'card', description: 'Tira cópias de um card de um usuário', aliases: ['carta'] })
  @CommandArgument([
    { name: 'amount', type: CommandArgumentType.NUMBER, description: 'Quantidade de cópias' },
    { name: 'card', type: CommandArgumentType.CARD, description: 'ID do card' },
    { name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário' },
  ])
  static async takeCard(ctx: IncomingCommand, args: {
    amount: number
    card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>
    target: string
  }) {
    if (args.amount <= 0) { await reply(ctx, '🃏 A quantidade tem que ser maior que zero.'); return }

    const resolved = await resolveStaffAndTarget(ctx, args.target)
    if (!resolved) return
    const { staff, target } = resolved
    const { card } = args

    const result = await CardsDB.removeUserCards(target.id, card.id, args.amount)
    if (!result.ok) {
      await reply(ctx, `😅 **${escapeMarkdown(target.displayName)}** não tem **${args.amount}x** de ${card.rarityEmoji} **${escapeMarkdown(card.name)}** pra tirar.`)
      return
    }

    await AuditDB.log(staff.id, 'card.confiscate', { targetUserId: target.id, cardId: card.id, amount: args.amount })

    const dm = buildCtx(ctx.message.platform, args.target, target.displayName, args.target)
    await reply(dm, `🃏 A staff tirou **${args.amount}x** ${card.rarityEmoji} **${escapeMarkdown(card.name)}** de você.`)

    await reply(ctx, `🃏 Pronto! **${args.amount}x** ${card.rarityEmoji} **${escapeMarkdown(card.name)}** foram tirados de **${escapeMarkdown(target.displayName)}**.`)
  }
}
