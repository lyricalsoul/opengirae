import { DBOS } from '@dbos-inc/dbos-sdk'
import { UsersDB } from '@girae/database/users'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { error } from '@girae/common/logger'
import type { IncomingCommand } from '@girae/common/commands/types'

// the guard rails every /doar-family command runs before looking at what is being donated. null = already replied, stop.
export async function resolveDonationParties(ctx: IncomingCommand, targetPlatformId: string, noun: 'cartas' | 'itens') {
  if (targetPlatformId === ctx.message.author.id) {
    await reply(ctx, `Você não pode doar ${noun} para você mesmo! 😅`)
    return null
  }

  const platform = ctx.message.platform as 'telegram' | 'discord'
  const donor = await UsersDB.getUserByPlatformAccount(platform, ctx.message.author.id)
  if (!donor) return null
  if (donor.isBanned) {
    await reply(ctx, `Você está banido de usar a Giraê e não pode doar ${noun}.`)
    return null
  }

  const recipient = await UsersDB.getUserByPlatformAccount(platform, targetPlatformId)
  if (!recipient) {
    await reply(ctx, 'O usuário mencionado nunca usou a bot! Talvez você marcou a pessoa errada?')
    return null
  }
  if (recipient.isBanned) {
    await reply(ctx, `Esse usuário está banido de usar a Giraê e não pode receber ${noun}.`)
    return null
  }

  return { platform, donor, recipient }
}

// ✅/❌ prompt restricted to the author; the prompt message is deleted once answered. Only meaningful inside a workflow.
export async function confirmByAuthor(ctx: IncomingCommand, eventName: string, content: string): Promise<boolean> {
  await reply(ctx, {
    content,
    eventName,
    restricted: 'author',
    options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
  })
  const selection = await DBOS.recv<{ value: boolean, messageId?: string }>(eventName)
  if (selection?.messageId) await deleteMsg(ctx, selection.messageId)
  return !!selection?.value
}

// an unexpected failure mid-transfer: the db error text can carry SQL and parameters, so it is logged and the chat gets a generic line.
export async function reportTransferFailure(ctx: IncomingCommand, scope: string, kind: 'doação' | 'troca', e: unknown) {
  error(scope, `${kind} failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`)
  await reply(ctx, `Não foi possível completar a ${kind}, algo deu errado do nosso lado. Nada foi movido, tenta de novo daqui a pouco. 😔`)
}
