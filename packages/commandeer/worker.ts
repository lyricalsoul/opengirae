import { Worker } from 'bullmq'
import { connection, responseQueue } from '@girae/common/queue'
import { COMMAND_QUEUE_NAME, RESUME_QUEUE_NAME, QUICKVIEW_QUEUE_NAME, PAGE_QUEUE_NAME } from '@girae/common/queue/constants'
import { executeCommand } from './services/commands'
import { DBOS } from '@girae/common/dbos'
import { info, error } from '@girae/common/logger'
import { findQuickView, findPage } from './loader'
import type { PendingResponse } from '@girae/common/commands/types'

export const commandWorker = new Worker(COMMAND_QUEUE_NAME, async (job) => {
  await executeCommand(job.data)
}, { connection })

commandWorker.on('completed', (job) => {
  info('commandeer', `Job ${job.id} (${job.data.name}) completed`)
})

commandWorker.on('failed', (job, err) => {
  error('commandeer', `Job ${job?.id} (${job?.data?.name}) failed: ${err.message}`)
})

export const resumeWorker = new Worker(RESUME_QUEUE_NAME, async (job) => {
  const { workflowID, eventName, value, messageId } = job.data
  await DBOS.send(workflowID, { value, messageId }, eventName)
}, { connection })

resumeWorker.on('failed', (job, err) => {
  error('commandeer', `Resume job ${job?.id} (workflow: ${job?.data?.workflowID}) failed: ${err.message}`)
})

export const quickViewWorker = new Worker(QUICKVIEW_QUEUE_NAME, async (job) => {
  const { handler, arg, callbackQueryId, clickerUserId } = job.data
  const entry = findQuickView(handler)
  if (!entry) return

  const text: string | undefined = await (entry.module as any)[entry.methodName](arg, clickerUserId)
  if (!text) return

  await responseQueue.add('answerCallbackQuery', {
    method: 'answerCallbackQuery',
    callbackQueryId,
    content: text,
    chatId: '',
    platform: 'telegram',
  } satisfies PendingResponse)
}, { connection })

quickViewWorker.on('failed', (job, err) => {
  error('commandeer', `Quick view job ${job?.id} (handler: ${job?.data?.handler}) failed: ${err.message}`)
})

export const pageWorker = new Worker(PAGE_QUEUE_NAME, async (job) => {
  const { handler, page, authorId, arg, clickerUserId, chatId, messageId } = job.data
  const entry = findPage(handler)
  if (!entry) return
  if (entry.restricted && clickerUserId !== authorId) return

  const result: {
    content: string
    photoUrl?: string
    hasNext: boolean
    extraRows?: Array<Array<{ text: string; arg: string; page: number }>>
  } | null = await (entry.module as any)[entry.methodName](arg, page, authorId)
  if (!result) return

  const pageButton = (label: string, targetPage: number, targetArg: string = arg) => ({
    text: label,
    callbackData: `pg:${handler}:${targetPage}:${authorId}:${targetArg}`,
  })
  const navRow = [
    ...(page > 0 ? [pageButton('⬅️ Anterior', page - 1)] : []),
    ...(result.hasNext ? [pageButton('Próxima ➡️', page + 1)] : []),
  ]
  const extraRows = (result.extraRows ?? []).map(row => row.map(b => pageButton(b.text, b.page, b.arg)))
  const buttons = [...extraRows, ...(navRow.length ? [navRow] : [])]

  await responseQueue.add('page', {
    method: result.photoUrl ? 'editMessageCaption' : 'editMessageText',
    chatId,
    messageId,
    content: result.content,
    photoUrl: result.photoUrl,
    platform: 'telegram',
    buttons: buttons.length ? buttons : undefined,
  } satisfies PendingResponse)
}, { connection })

pageWorker.on('failed', (job, err) => {
  error('commandeer', `Page job ${job?.id} (handler: ${job?.data?.handler}) failed: ${err.message}`)
})

const shutdown = async () => {
  await Promise.all([commandWorker.close(), resumeWorker.close(), quickViewWorker.close(), pageWorker.close()])
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

