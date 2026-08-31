import { Command, Subcommand, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import { EconomyDB } from '@girae/database/economy'
import { AuditDB } from '@girae/database/audit'
import { reply } from '@girae/common/dbos/messaging'
import { buildCtx } from '../../services/syntheticCtx'
import { resolveStaffAndTarget } from '../../services/users/staffGrant'
import { emitCardsNew } from '../../loaders/hooks'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

export default class DarCommand extends Command {
  static override info = {
    guards: ['isAdmin', 'staffGroupOnly'],
    name: 'dar',
    description: 'Dá moedas, giros ou cards para um usuário (staff, só no grupo da staff)',
    usage: '/dar <moedas|giros|card> <quantidade> [ID do card] <@usuário> (ou em resposta ao usuário)',
    aliases: ['give'],
  }

  static override async execute(ctx: IncomingCommand) {
    await reply(ctx, `Uso: \`${this.info.usage}\``)
  }

  @Subcommand({ name: 'moedas', description: 'Dá moedas para um usuário', aliases: ['coins'] })
  @CommandArgument([
    { name: 'amount', type: CommandArgumentType.NUMBER, description: 'Quantidade de moedas' },
    { name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário' },
  ])
  static async giveCoins(ctx: IncomingCommand, args: { amount: number; target: string }) {
    if (args.amount <= 0) { await reply(ctx, '💸 A quantidade tem que ser maior que zero.'); return }

    const resolved = await resolveStaffAndTarget(ctx, args.target)
    if (!resolved) return
    const { staff, target } = resolved

    await UsersDB.addCoins(target.id, args.amount)
    await AuditDB.log(staff.id, 'coins.grant', { targetUserId: target.id, amount: args.amount })

    const dm = buildCtx(ctx.message.platform, args.target, target.displayName, args.target)
    await reply(dm, `💰 A staff te deu **${args.amount}** moedas!`)

    await reply(ctx, `💰 Pronto! **${args.amount}** moedas foram dadas para **${escapeMarkdown(target.displayName)}**.`)
  }

  @Subcommand({ name: 'giros', description: 'Dá giros para um usuário', aliases: ['spins'] })
  @CommandArgument([
    { name: 'amount', type: CommandArgumentType.NUMBER, description: 'Quantidade de giros' },
    { name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário' },
  ])
  static async giveGiros(ctx: IncomingCommand, args: { amount: number; target: string }) {
    if (args.amount <= 0) { await reply(ctx, '🎲 A quantidade tem que ser maior que zero.'); return }

    const resolved = await resolveStaffAndTarget(ctx, args.target)
    if (!resolved) return
    const { staff, target } = resolved

    await UsersDB.giveTemporaryDraws(target.id, args.amount)
    await AuditDB.log(staff.id, 'draws.grant', { targetUserId: target.id, amount: args.amount })

    const dm = buildCtx(ctx.message.platform, args.target, target.displayName, args.target)
    await reply(dm, `🎲 A staff te deu **${args.amount}** giros!`)

    await reply(ctx, `🎲 Pronto! **${args.amount}** giros foram dados para **${escapeMarkdown(target.displayName)}**.`)
  }

  @Subcommand({ name: 'card', description: 'Dá cópias de um card para um usuário', aliases: ['carta'] })
  @CommandArgument([
    { name: 'amount', type: CommandArgumentType.NUMBER, description: 'Quantidade de cópias' },
    { name: 'card', type: CommandArgumentType.CARD, description: 'ID do card' },
    { name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário' },
  ])
  static async giveCard(ctx: IncomingCommand, args: {
    amount: number
    card: NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>
    target: string
  }) {
    if (args.amount <= 0) { await reply(ctx, '🃏 A quantidade tem que ser maior que zero.'); return }

    const resolved = await resolveStaffAndTarget(ctx, args.target)
    if (!resolved) return
    const { staff, target } = resolved
    const { card } = args

    const incomeInflationRate = await EconomyDB.getIncomeInflationRate()
    const result = await CardsDB.grantUserCards(target.id, card.id, args.amount, incomeInflationRate)

    await emitCardsNew(target.id, args.target, target.displayName, ctx.message.platform, [
      { cardId: card.id, previousCount: result.previousCount, newCount: result.newCount, completedSubcategories: result.completedSubcategories },
    ])

    await AuditDB.log(staff.id, 'card.grant', { targetUserId: target.id, cardId: card.id, amount: args.amount })

    const dm = buildCtx(ctx.message.platform, args.target, target.displayName, args.target)
    await reply(dm, `🃏 A staff te deu **${args.amount}x** ${card.rarityEmoji} **${escapeMarkdown(card.name)}**!`)

    await reply(ctx, `🃏 Pronto! **${args.amount}x** ${card.rarityEmoji} **${escapeMarkdown(card.name)}** foram dados para **${escapeMarkdown(target.displayName)}**.`)
  }
}
