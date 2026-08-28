import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { DiscotecaDB, InsufficientDiscotecaEntryError } from '@girae/database/discoteca'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import { reply, deleteMsg, awaitMultiPartyChoice } from '@girae/common/dbos/messaging'
import { generateTradeImage } from '@girae/common/ditto'
import { DEFAULT_AVATAR_URL } from '@girae/database/constants'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'

const CONFIRM_EVENT = 'stradedisco:confirm'
const INACTIVITY_TIMEOUT_SECONDS = 30 * 60
const FALLBACK_TRADE_IMAGE = 'https://placehold.co/1200x630/png'

type EntryWithDetails = NonNullable<Awaited<ReturnType<typeof DiscotecaDB.getEntryWithDetails>>>

const entryLine = (entry: EntryWithDetails) => `${entry.rarityEmoji} \`${entry.id}\`. **${escapeMarkdown(entry.name)}**`

export default class SimpleTradeDiscoCommand extends Command {
  static override info = {
    name: 'stradedisco',
    description: 'Troca rápida de álbuns/singles com outro usuário',
    usage: '/stradedisco <item que você oferece> <item que você quer> (em resposta ao usuário)',
    aliases: ['strocadisco'],
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([
    { name: 'target', type: CommandArgumentType.USER_MENTION, description: 'Usuário para trocar itens' },
    { name: 'myEntry', type: CommandArgumentType.DISCOTECA_ENTRY, description: 'ID ou nome do seu álbum/single' },
    { name: 'theirEntry', type: CommandArgumentType.DISCOTECA_ENTRY, description: 'ID ou nome do álbum/single dele' },
  ])
  static override async execute(ctx: IncomingCommand, args: { target: string; myEntry: EntryWithDetails; theirEntry: EntryWithDetails }) {
    const targetTelegramId = args.target
    const m = (id: string, name: string) => mention(ctx.message.platform, id, name)

    if (targetTelegramId === ctx.message.author.id) {
      await reply(ctx, 'Você não pode trocar itens com você mesmo! 😅')
      return
    }

    const proposerUser = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!proposerUser) return
    if (proposerUser.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode realizar trocas.')
      return
    }

    const targetUser = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', targetTelegramId)
    if (!targetUser) {
      await reply(ctx, 'O usuário mencionado nunca usou a bot! Talvez você marcou a pessoa errada?')
      return
    }
    if (targetUser.isBanned) {
      await reply(ctx, 'Esse usuário está banido de usar a Giraê e não pode realizar trocas.')
      return
    }

    const proposerName = proposerUser.displayName
    const targetName = targetUser.displayName

    const myOwned = await DiscotecaDB.getUserDiscoteca(proposerUser.id, args.myEntry.id)
    if (!myOwned || myOwned.count === 0) {
      await reply(ctx, `Você não tem nenhuma cópia de **${escapeMarkdown(args.myEntry.name)}** para trocar!`)
      return
    }
    if (!(await DiscotecaDB.isEntryTradable(proposerUser.id, args.myEntry.id))) {
      await reply(ctx, `**${escapeMarkdown(args.myEntry.name)}** não está marcado como trocável. Use \`/trocodisco ${args.myEntry.id}\` primeiro.`)
      return
    }
    const theirOwned = await DiscotecaDB.getUserDiscoteca(targetUser.id, args.theirEntry.id)
    if (!theirOwned || theirOwned.count === 0) {
      await reply(ctx, `${m(targetTelegramId, targetName)} não tem nenhuma cópia de **${escapeMarkdown(args.theirEntry.name)}** para trocar!`)
      return
    }
    if (!(await DiscotecaDB.isEntryTradable(targetUser.id, args.theirEntry.id))) {
      await reply(ctx, `**${escapeMarkdown(args.theirEntry.name)}** não está marcado como trocável pelo dono.`)
      return
    }

    const proposerAvatarUrl = proposerUser.avatarUrl || DEFAULT_AVATAR_URL
    const targetAvatarUrl = targetUser.avatarUrl || DEFAULT_AVATAR_URL

    const image = await generateTradeImage({
      user1: { avatarURL: proposerAvatarUrl, name: proposerName, cards: args.myEntry.artworkUrl ? [args.myEntry.artworkUrl] : [] },
      user2: { avatarURL: targetAvatarUrl, name: targetName, cards: args.theirEntry.artworkUrl ? [args.theirEntry.artworkUrl] : [] },
    }).catch(() => null) ?? { url: FALLBACK_TRADE_IMAGE }

    const content = `💱 Troca entre ${m(ctx.message.author.id, proposerName)} e ${m(targetTelegramId, targetName)}\n\n💽 **${escapeMarkdown(proposerName)}** está oferecendo:\n\n${entryLine(args.myEntry)}\n\n💽 **${escapeMarkdown(targetName)}** está oferecendo:\n\n${entryLine(args.theirEntry)}\n\nCliquem em **✅ Confirmar** para finalizar a troca, ou **❌ Cancelar** para cancelar a troca.\nAtenção: a troca será desfeita caso um dos usuários clique em cancelar. Preste atenção!`

    const result = await awaitMultiPartyChoice<'confirm' | 'cancel'>(
      ctx,
      CONFIRM_EVENT,
      { content, photoUrl: image.url },
      [{ title: '✅ Confirmar', data: 'confirm', color: 'success' }, { title: '❌ Cancelar', data: 'cancel', color: 'danger' }],
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
      const incomeInflationRate = await EconomyDB.getIncomeInflationRate()
      await CardsDB.executeMixedTrade(
        proposerUser.id, [], [{ entryId: args.myEntry.id, count: 1 }],
        targetUser.id, [], [{ entryId: args.theirEntry.id, count: 1 }],
        incomeInflationRate,
      )
    } catch (e) {
      if (result.messageId) await deleteMsg(ctx, result.messageId)
      if (e instanceof InsufficientDiscotecaEntryError) {
        const who = e.userId === proposerUser.id ? proposerName : targetName
        await reply(ctx, `Não foi possível completar a troca: **${escapeMarkdown(who)}** não tem mais o item oferecido, ou ele deixou de estar trocável.`)
      } else {
        await reply(ctx, `Não foi possível completar a troca: ${(e as Error).message}`)
      }
      return
    }

    await reply(ctx, {
      content: `🎉 Troca realizada com sucesso!\n\n💽 **${escapeMarkdown(proposerName)}** recebeu:\n\n${entryLine(args.theirEntry)}\n\n💽 **${escapeMarkdown(targetName)}** recebeu:\n\n${entryLine(args.myEntry)}`,
      photoUrl: image.url,
      editMessageId: result.messageId,
      captionOnly: true,
    })
  }
}
