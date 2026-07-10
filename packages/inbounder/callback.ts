import type { StoredStep, Message, IncomingCommand } from '@girae/common/commands/types'
import { rawClient, resumeQueue, quickViewQueue, pageQueue, commandQueue } from '@girae/common/queue'

export async function processCallback(
  callbackData: string,
  clickerUserId: string,
  callbackQueryId: string,
  chatId?: string,
  messageId?: string,
  clickerName?: string,
) {
  // cmd:name:arg1,arg2 simulates the clicker typing `/name arg1 arg2`
  if (callbackData.startsWith('cmd:')) {
    const rest = callbackData.slice(4)
    const sep = rest.indexOf(':')
    const name = sep === -1 ? rest : rest.slice(0, sep)
    const args = sep === -1 ? [] : rest.slice(sep + 1).split(',').filter(Boolean)
    if (!name || !chatId) return

    const message: Message = {
      id: messageId ?? Bun.randomUUIDv7(),
      author: { id: clickerUserId, name: clickerName ?? 'unknown', avatarUrl: '' },
      chat: { id: chatId, title: '' },
      content: `/${name} ${args.join(' ')}`.trim(),
      timestamp: new Date(),
      platform: 'telegram',
    }

    await commandQueue.add('executeCommand', {
      name,
      args,
      message,
      workflowIDToBeAssigned: Bun.randomUUIDv7(),
    } satisfies IncomingCommand)
    return
  }

  // quick views (qv:handler:arg) answer directly via answerCallbackQuery w no workflow needed
  if (callbackData.startsWith('qv:')) {
    const rest = callbackData.slice(3)
    const sep = rest.indexOf(':')
    if (sep === -1) return
    const handler = rest.slice(0, sep)
    const arg = rest.slice(sep + 1)
    if (!handler) return

    await quickViewQueue.add('quickview', { handler, arg, callbackQueryId, clickerUserId })
    return
  }

  // pages (pg:handler:page:authorId:arg) re-render the message in place w no workflow
  if (callbackData.startsWith('pg:')) {
    const parts = callbackData.slice(3).split(':')
    const [handler, pageStr, authorId, ...argParts] = parts
    const page = parseInt(pageStr ?? '', 10)
    const arg = argParts.join(':')
    if (!handler || isNaN(page) || !authorId || !chatId || !messageId) return

    await pageQueue.add('page', { handler, page, authorId, arg, clickerUserId, chatId, messageId })
    return
  }

  const dotIndex = callbackData.indexOf('.')
  const lastDot = callbackData.lastIndexOf('.')
  if (dotIndex === -1 || dotIndex === lastDot) return

  const workflowID = callbackData.slice(0, dotIndex)
  const eventName = callbackData.slice(dotIndex + 1, lastDot)
  const optionIndex = callbackData.slice(lastDot + 1)

  if (!workflowID || !eventName || !optionIndex) return

  const redisKey = `workflow:${workflowID}`
  const raw = await rawClient.hGet(redisKey, eventName)

  // TODO: reply with invalid command
  if (!raw) return

  await rawClient.hDel(redisKey, eventName)

  const step: StoredStep = JSON.parse(raw)

  // TODO: reply with command not for you
  if (step.restricted === 'author' && !step.authorIds.includes(clickerUserId)) return

  const selected = step.options.find(o => o.id === optionIndex)
  if (!selected) return

  await resumeQueue.add('resume', {
    workflowID,
    eventName,
    value: selected.data,
    messageId,
  })
}

