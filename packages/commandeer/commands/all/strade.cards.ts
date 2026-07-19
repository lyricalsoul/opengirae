import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB, InsufficientCardError } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { reply, deleteMsg, awaitMultiPartyChoice } from '@girae/common/dbos/messaging'
import { generateTradeImage } from '@girae/common/ditto'
import { DEFAULT_AVATAR_URL } from '@girae/database/constants'
import { tg } from '../../services/botInfo'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'

const CONFIRM_EVENT = 'strade:confirm'
const INACTIVITY_TIMEOUT_SECONDS = 30 * 60
const FALLBACK_TRADE_IMAGE = 'https://placehold.co/1200x630/png'

type CardWithDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>

const cardLine = (card: CardWithDetails) => `${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**`

export default class SimpleTradeCommand extends Command {
  static override info = {
    name: 'strade',
    description: 'Troca rápida de cartas com outro usuário',
    usage: '/strade <card que você oferece> <card que você quer> (em resposta ao usuário)',
    aliases: ['strocar', 'stroca'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([
    { name: 'target', type: CommandArgumentType.USER_MENTION },
    { name: 'myCard', type: CommandArgumentType.CARD },
    { name: 'theirCard', type: CommandArgumentType.CARD },
  ])
  static override async execute(ctx: IncomingCommand, args: { target: string; myCard: CardWithDetails; theirCard: CardWithDetails }) {
    const targetTelegramId = args.target
    const m = (id: string, name: string) => mention(ctx.message.platform, id, name)

    if (targetTelegramId === ctx.message.author.id) {
      await reply(ctx, 'Você não pode trocar cartas com você mesmo! 😅')
      return
    }

    const proposerUser = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!proposerUser) return
    if (proposerUser.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode realizar trocas de cartas.')
      return
    }

    const targetUser = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', targetTelegramId)
    if (!targetUser) {
      await reply(ctx, 'O usuário mencionado nunca usou a bot! Talvez você marcou a pessoa errada?')
      return
    }
    if (targetUser.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode realizar trocas de cartas.')
      return
    }

    const proposerName = proposerUser.displayName
    const targetName = targetUser.displayName

    const myOwned = await CardsDB.getUserCard(proposerUser.id, args.myCard.id)
    if (!myOwned || myOwned.count === 0) {
      await reply(ctx, `Você não tem nenhum card de **${escapeMarkdown(args.myCard.name)}** para trocar!`)
      return
    }
    const theirOwned = await CardsDB.getUserCard(targetUser.id, args.theirCard.id)
    if (!theirOwned || theirOwned.count === 0) {
      await reply(ctx, `${m(targetTelegramId, targetName)} não tem nenhum card de **${escapeMarkdown(args.theirCard.name)}** para trocar!`)
      return
    }

    const proposerAvatarUrl = proposerUser.avatarUrl || DEFAULT_AVATAR_URL
    const targetAvatarUrl = targetUser.avatarUrl || DEFAULT_AVATAR_URL

    const image = await generateTradeImage({
      user1: { avatarURL: proposerAvatarUrl, name: proposerName, cards: args.myCard.imageUrl ? [args.myCard.imageUrl] : [] },
      user2: { avatarURL: targetAvatarUrl, name: targetName, cards: args.theirCard.imageUrl ? [args.theirCard.imageUrl] : [] },
    }).catch(() => null) ?? { url: FALLBACK_TRADE_IMAGE }

    const content = `💱 Troca entre ${m(ctx.message.author.id, proposerName)} e ${m(targetTelegramId, targetName)}\n\n🃏 **${escapeMarkdown(proposerName)}** está oferecendo:\n\n${cardLine(args.myCard)}\n\n🃏 **${escapeMarkdown(targetName)}** está oferecendo:\n\n${cardLine(args.theirCard)}\n\nCliquem em **✅ Confirmar** para finalizar a troca, ou **❌ Cancelar** para cancelar a troca.\nAtenção: a troca será desfeita caso um dos usuários clique em cancelar. Preste atenção!`

    const result = await awaitMultiPartyChoice<'confirm' | 'cancel'>(
      ctx,
      CONFIRM_EVENT,
      { content, photoUrl: image.url },
      [{ title: '✅ Confirmar', data: 'confirm' }, { title: '❌ Cancelar', data: 'cancel' }],
      [ctx.message.author.id, targetTelegramId],
      (c) => c.data === 'cancel' || c.clickerUserId === targetTelegramId,
      INACTIVITY_TIMEOUT_SECONDS,
    )

    if (!result) {
      await reply(ctx, 'A troca expirou por inatividade. 😴')
      return
    }
    if (result.data === 'cancel') {
      if (result.messageId) await deleteMsg(ctx, result.messageId)
      await reply(ctx, `Vish... a troca entre ${m(ctx.message.author.id, proposerName)} e ${m(targetTelegramId, targetName)} foi cancelada. Será que se arrependeram? 😅`)
      return
    }

    try {
      await CardsDB.executeTrade(proposerUser.id, [{ cardId: args.myCard.id, count: 1 }], targetUser.id, [{ cardId: args.theirCard.id, count: 1 }])
    } catch (e) {
      if (result.messageId) await deleteMsg(ctx, result.messageId)
      if (e instanceof InsufficientCardError) {
        const who = e.userId === proposerUser.id ? proposerName : targetName
        await reply(ctx, `Não foi possível completar a troca: **${escapeMarkdown(who)}** não tem mais o card oferecido.`)
      } else {
        await reply(ctx, `Não foi possível completar a troca: ${(e as Error).message}`)
      }
      return
    }

    await reply(ctx, {
      content: `🎉 Troca realizada com sucesso!\n\n🃏 **${escapeMarkdown(proposerName)}** recebeu:\n\n${cardLine(args.theirCard)}\n\n🃏 **${escapeMarkdown(targetName)}** recebeu:\n\n${cardLine(args.myCard)}`,
      photoUrl: image.url,
      editMessageId: result.messageId,
      captionOnly: true,
    })
  }
}
