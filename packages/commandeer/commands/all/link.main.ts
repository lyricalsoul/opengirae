import { Command } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, awaitMultiPartyChoice } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { rawClient } from '@girae/common/queue'
import { invalidateCachedUserId } from '@girae/common/cache/users'
import type { IncomingCommand } from '@girae/common/commands/types'

const LINK_CODE_TTL_SECONDS = 5 * 60
const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no ambiguous chars (0/O, 1/I/L)

function generateLinkCode(): string {
  let code = ''
  for (let i = 0; i < 6; i++) code += LINK_CODE_ALPHABET[Math.floor(Math.random() * LINK_CODE_ALPHABET.length)]
  return code
}

export default class LinkCommand extends Command {
  static override info = {
    name: 'link',
    description: 'Vincula sua conta a outra plataforma (Telegram/Discord)',
    usage: '/link [código]',
    useWorkflow: true,
    ephemeral: true,
  }

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand, args: { code?: string }) {
    const code = ctx.args[0]?.trim()
    if (code) {
      await redeemCode(ctx, code)
      return
    }

    await startLink(ctx)
  }
}

async function startLink(ctx: IncomingCommand) {
  const platform = ctx.message.platform as 'telegram' | 'discord'
  const initiator = await UsersDB.getUserByPlatformAccount(platform, ctx.message.author.id)
  if (!initiator) return

  const choice = await awaitMultiPartyChoice<'this' | 'other'>(
    ctx,
    'link-primary-choice',
    {
      content: 'Após o link, os dados de uma de suas contas se tornará principal. Os dados dessa conta (biografia, cor favorita, etc) serão usadas tanto aqui quanto na outra plataforma. Qual conta você considera como sua principal?',
    },
    [
      { title: 'Esta conta', data: 'this' },
      { title: 'A outra conta', data: 'other' },
    ],
    [ctx.message.author.id],
    () => true,
    120,
  )

  if (!choice) {
    await reply(ctx, 'Tempo esgotado. Use `/link` novamente quando quiser.')
    return
  }

  const linkCode = generateLinkCode()
  await rawClient.set(`link:code:${linkCode}`, JSON.stringify({
    initiatorUserId: initiator.id,
    primaryIsInitiator: choice.data === 'this',
  }), { EX: LINK_CODE_TTL_SECONDS })

  await reply(ctx, {
    content: `🔗 Código de vínculo: \`${linkCode}\`\n\nNa outra plataforma, use \`/link ${linkCode}\` dentro de 5 minutos.`,
    editMessageId: choice.messageId,
  })
}

async function redeemCode(ctx: IncomingCommand, code: string) {
  const platform = ctx.message.platform as 'telegram' | 'discord'
  const redeemer = await UsersDB.getUserByPlatformAccount(platform, ctx.message.author.id)
  if (!redeemer) return

  const raw = await rawClient.get(`link:code:${code.toUpperCase()}`)
  if (!raw) {
    await reply(ctx, '❌ Código inválido ou expirado.')
    return
  }

  const { initiatorUserId, primaryIsInitiator } = JSON.parse(raw) as { initiatorUserId: number; primaryIsInitiator: boolean }

  if (initiatorUserId === redeemer.id) {
    await reply(ctx, '❌ Você não pode vincular sua conta a ela mesma.')
    return
  }

  const mainUserId = primaryIsInitiator ? initiatorUserId : redeemer.id
  const secondaryUserId = primaryIsInitiator ? redeemer.id : initiatorUserId

  // captured before the merge - mergeUsers repoints these rows, so they won't resolve after
  const secondaryPlatformIds = await Promise.all(
    (['telegram', 'discord'] as const).map(async platform => ({ platform, platformId: await UsersDB.getPlatformIdForUser(secondaryUserId, platform) }))
  )

  try {
    await UsersDB.mergeUsers(mainUserId, secondaryUserId)
  } catch {
    await reply(ctx, '❌ Erro ao vincular as contas. Tente novamente com o mesmo código.')
    return
  }

  for (const { platform, platformId } of secondaryPlatformIds) {
    if (platformId) await invalidateCachedUserId(platform, platformId)
  }

  await rawClient.del(`link:code:${code.toUpperCase()}`)
  await reply(ctx, '✅ Contas vinculadas com sucesso!')
}
