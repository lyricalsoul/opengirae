import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'

type CardRow = { id: number; name: string; rarityName: string; rarityEmoji: string }

const cardLine = (c: CardRow) => `${c.rarityEmoji} \`${c.id}\`. **${escapeMarkdown(c.name)}**`

export default class CompareCommand extends Command {
  static override info = {
    name: 'compare',
    description: 'Compara sua lista de desejos com a de outro usuário',
    usage: '/compare @usuário (ou em resposta ao usuário)',
    aliases: ['comparar', 'compare'],
  }

  @CommandArgument([{ name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário para comparar' }])
  static override async execute(ctx: IncomingCommand, args: { target: string }) {
    const targetTelegramId = args.target

    if (targetTelegramId === ctx.message.author.id) {
      await reply(ctx, 'Você não pode comparar sua lista de desejos com você mesmo! 😅')
      return
    }

    const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!viewer) return

    const target = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', targetTelegramId)
    if (!target) {
      await reply(ctx, 'O usuário mencionado nunca usou a bot! Talvez você marcou a pessoa errada?')
      return
    }

    const { iHaveTheyWant, theyHaveIWant } = await CardsDB.compareWishlists(viewer.id, target.id)
    const m = (id: string, name: string) => mention(ctx.message.platform, id, name)

    const iHaveSection = iHaveTheyWant.length > 0
      ? `🎁 Você tem que ${m(targetTelegramId, target.displayName)} quer:\n\n${iHaveTheyWant.map(cardLine).join('\n')}`
      : `🎁 Você não tem nenhum card trocável que ${m(targetTelegramId, target.displayName)} quer.`

    const theyHaveSection = target.privacyMode
      ? `🔒 ${m(targetTelegramId, target.displayName)} ativou o modo privado — não é possível ver o que ele(a) tem que você quer.`
      : theyHaveIWant.length > 0
        ? `🎁 ${m(targetTelegramId, target.displayName)} tem que você quer:\n\n${theyHaveIWant.map(cardLine).join('\n')}`
        : `🎁 ${m(targetTelegramId, target.displayName)} não tem nenhum card trocável que você quer.`

    await reply(ctx, `🔍 Comparando listas de desejos\n\n${iHaveSection}\n\n${theyHaveSection}`)
  }
}
