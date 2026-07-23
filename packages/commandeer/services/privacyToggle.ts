import { reply } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import type { IncomingCommand } from '@girae/common/commands/types'

export async function togglePrivacyMode(ctx: IncomingCommand): Promise<void> {
  const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
  if (!user) return

  const next = !user.privacyMode
  await UsersDB.setPrivacyMode(user.id, next)
  await reply(ctx, next
    ? '🔒 Modo privado ativado! Outros usuários não podem mais ver seu perfil, cards ou lista de desejos.'
    : '🔓 Modo privado desativado! Outros usuários podem ver seu perfil, cards e lista de desejos novamente.')
}
