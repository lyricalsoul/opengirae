import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { cativeiroEligibilityGuard, validateCustomEmoji } from '../../services/cativeiro'

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

export default class EmojicardCommand extends Command {
  static override info = {
    name: 'emojicard',
    description: 'Personaliza um card elegível para cativeiro com um emoji',
    usage: '/emojicard <id do card> <emoji>',
  }

  @CommandArgument([
    { name: 'card', type: CommandArgumentType.CARD, guard: cativeiroEligibilityGuard },
    { name: 'emoji', type: CommandArgumentType.STRING, guard: validateCustomEmoji },
  ])
  static override async execute(ctx: IncomingCommand, args: { card: CardDetails; emoji: string }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const emoji = args.emoji.trim()
    await CardsDB.setUserCardCustomEmoji(user.id, args.card.id, emoji)

    await reply(ctx, `✨ Prontinho! Seu card agora aparece como ${emoji} \`${args.card.id}\`. **${escapeMarkdown(args.card.name)}**.`)
  }
}
