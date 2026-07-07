import type { StoredStep } from '@girae/common/commands/types'
import { rawClient, resumeQueue } from '@girae/common/queue'

export async function processCallback(
  callbackData: string,
  clickerUserId: string,
  messageId?: string
) {
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

