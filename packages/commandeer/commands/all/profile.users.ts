import { Command, Subcommand, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import { DEFAULT_AVATAR_URL } from '@girae/database/constants'
import type { IncomingCommand } from '@girae/common/commands/types'
import { generateProfileImage } from '@girae/common/ditto'
import { buildProfileData } from '@girae/common/profileData'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { tg } from '../../services/botInfo'
import { togglePrivacyMode } from '../../services/privacyToggle'

export default class ProfileCommand extends Command {
  static override info = {
    name: 'profile',
    description: 'Mostra seu perfil de usuário',
    usage: '/profile [@usuário]',
    aliases: ['perfil', 'pf', 'pfp', 'ppc'],
    discordEntrypointName: 'view',
  }

  @CommandArgument([{ name: 'target', type: CommandArgumentType.USER_MENTION, nullable: true, description: 'Usuário para ver o perfil' }])
  static override async execute(ctx: IncomingCommand, args: { target?: string }) {
    const targetTelegramId = args.target ?? ctx.message.author.id

    const profileRow = await UsersDB.getUserProfileByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', targetTelegramId)
    const user = profileRow?.users
    const profile = profileRow?.user_profiles
    if (!user || !profile) {
      await reply(ctx, 'Não encontrei o perfil desse usuário. 😔\nEle já usou a bot?')
      return
    }

    if (targetTelegramId !== ctx.message.author.id) {
      const viewer = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
      if (!viewer) return
      if (!UsersDB.isViewable(viewer.id, user)) {
        await reply(ctx, 'Esse usuário ativou o modo privado e não é possível ver o perfil dele. 🔒')
        return
      }
    }

    const favoriteCard = user.favoriteCardId ? await CardsDB.getCardWithDetails(user.favoriteCardId) : null

    const avatarUrl = user.avatarUrl || DEFAULT_AVATAR_URL

    const profileData = await buildProfileData(ctx.message.platform as 'telegram' | 'discord', targetTelegramId, { avatarURL: avatarUrl })
    const image = profileData ? await generateProfileImage(profileData) : null

    const favCardText = favoriteCard
      ? `\n\n${favoriteCard.rarityEmoji} \`${favoriteCard.id}\`. **${escapeMarkdown(favoriteCard.name)}**\n${favoriteCard.categoryEmoji ?? ''} _${escapeMarkdown(favoriteCard.subcategoryName ?? '')}_`
      : ''

    const drawsLeft = user.maxDraws - user.usedDraws
    const cardsCount = profileData?.totalCards ?? 0

    const caption = `🖼 \`${user.id}\`. **${escapeMarkdown(user.displayName)}**

🌠 **Reputação** - _${profile.reputation} ponto${profile.reputation === 1 ? '' : 's'}_
🃏 **Cartas** - _${cardsCount} ${cardsCount === 1 ? 'colecionável' : 'colecionáveis'}_
💸 **Moedas** - _${user.coins} moeda${user.coins === 1 ? '' : 's'}_
🎲 **Giros** - _${drawsLeft} giro${drawsLeft === 1 ? '' : 's'} sobrando_${favCardText}

*quer editar seu perfil? use \`/profile edit\` para informações*
`

    await reply(ctx, {
      content: caption,
      photoUrl: image?.url ?? avatarUrl
    })
  }

  @Subcommand({ name: 'edit', description: 'Mostra como editar seu perfil', aliases: ['editar'] })
  static async showEditHelp(ctx: IncomingCommand) {
    await reply(ctx, `🖼 **Como editar o perfil?**

/bio - define sua biografia (exemplo: \`/bio eu amo a ningning\`)
/favcolor - define a cor que aparece no seu perfil (exemplo: \`/favcolor #ff0000\`)
/profile emoji off - esconde os emojis do seu perfil
/profile emoji on - reativa os emojis do seu perfil
/fav - define sua carta favorita (exemplo: \`/fav Karol Conká\`)
/wish - mostra ou edita sua lista de desejos (exemplo: \`/wish Karol Conká\`)
/compare @usuário - compara sua lista de desejos com a de outra pessoa
/troco - marca um card como trocável (exemplo: \`/troco Karol Conká\`)
/naotroco - marca um card como não trocável (exemplo: \`/naotroco Karol Conká\`)
/autotroca - alterna se cards novos são trocáveis por padrão
/privacy - ativa ou desativa o modo privado (esconde seu perfil, cards e lista de desejos)
`)
  }

  @Subcommand({ name: 'emo', description: 'Ativa ou desativa os emojis do seu perfil', aliases: ['emoji', 'emojis'] })
  @CommandArgument([{ name: 'enabled', type: CommandArgumentType.BOOLEAN, description: 'Ativar ou desativar' }])
  static async toggleEmojis(ctx: IncomingCommand, args: { enabled: boolean }) {
    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const hide = !args.enabled
    await UsersDB.updateUserProfile(user.id, { hideProfileEmojis: hide })
    await reply(ctx, hide ? 'Emojis escondidos com sucesso! 🎨' : 'Emojis ativados com sucesso! 🎨')
  }

  @Subcommand({ name: 'privacidade', description: 'Ativa ou desativa o modo privado', aliases: ['privacy'] })
  static async togglePrivacy(ctx: IncomingCommand) {
    await togglePrivacyMode(ctx)
  }
}
