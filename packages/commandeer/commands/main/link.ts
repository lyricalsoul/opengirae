import { Command } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, awaitMultiPartyChoice } from '@girae/common/dbos/messaging'
import { UsersDB } from '@girae/database/users'
import { rawClient } from '@girae/common/queue'
import { invalidateCachedUserId } from '@girae/common/cache/users'
import { error } from '@girae/common/logger'
import type { IncomingCommand } from '@girae/common/commands/types'

const LINK_CODE_TTL_SECONDS = 5 * 60
const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no ambiguous chars (0/O, 1/I/L)

function generateLinkCode(): string {
  let code = ''
  // rejection sampling over a csprng: a plain modulo would favour the first alphabet characters
  const limit = 256 - (256 % LINK_CODE_ALPHABET.length)
  while (code.length < 6) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < limit && code.length < 6) code += LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length]
    }
  }
  return code
}

// telegram DMs have positive chat ids, groups negative; discord replies are ephemeral. A code posted in a group lets anyone in it redeem it and merge into the account.
export const isPrivateLinkChat = (ctx: IncomingCommand) =>
  ctx.message.platform !== 'telegram' || !ctx.message.chat.id.startsWith('-')

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
    if (!isPrivateLinkChat(ctx)) {
      await reply(ctx, '🔒 Por segurança, o `/link` só funciona no privado com a bot. Me chama no privado e tenta de novo.')
      return
    }

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

  // two redeems of the same code racing would both merge - only the SET NX winner proceeds
  const claimKey = `link:claim:${code.toUpperCase()}`
  if ((await rawClient.set(claimKey, '1', { EX: 60, NX: true })) !== 'OK') {
    await reply(ctx, '❌ Esse código já está sendo usado.')
    return
  }

  try {
    await UsersDB.mergeUsers(mainUserId, secondaryUserId)
  } catch (e) {
    error('link', `mergeUsers(${mainUserId}, ${secondaryUserId}) failed: ${e instanceof Error ? e.message : String(e)}`)
    await rawClient.del(claimKey)
    await reply(ctx, '❌ Erro ao vincular as contas. Tente novamente com o mesmo código.')
    return
  }

  for (const { platform, platformId } of secondaryPlatformIds) {
    if (platformId) await invalidateCachedUserId(platform, platformId)
  }

  await rawClient.del(`link:code:${code.toUpperCase()}`)
  await rawClient.del(claimKey)
  await reply(ctx, '✅ Contas vinculadas com sucesso!')
}
