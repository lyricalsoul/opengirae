import { Worker, MetricsTime } from 'bullmq'
import { connection, responseQueue } from '@girae/common/queue'
import { COMMAND_QUEUE_NAME, RESUME_QUEUE_NAME, QUICKVIEW_QUEUE_NAME, PAGE_QUEUE_NAME } from '@girae/common/queue/constants'
import { executeCommand } from './services/commands'
import { DBOS } from '@girae/common/dbos'
import { info, error } from '@girae/common/logger'
import { findQuickView, findPage } from './loaders/commands'
import type { PendingResponse } from '@girae/common/commands/types'
import { pageNavSteps } from '@girae/common/dbos/messaging'

const QUEUE_WAIT_WARN_MS = 5000

export const commandWorker = new Worker(COMMAND_QUEUE_NAME, async (job) => {
  const waitMs = Date.now() - job.timestamp
  if (waitMs > QUEUE_WAIT_WARN_MS) info('commandeer', `Job ${job.id} (${job.data.name}) started after waiting ${waitMs}ms in queue`)
  await executeCommand(job.data)
}, { connection, metrics: { maxDataPoints: MetricsTime.ONE_WEEK * 2 } })

commandWorker.on('completed', (job) => {
  info('commandeer', `Job ${job.id} (${job.data.name}) completed`)
})

commandWorker.on('failed', (job, err) => {
  error('commandeer', `Job ${job?.id} (${job?.data?.name}) failed: ${err.message}`)
})

export const resumeWorker = new Worker(RESUME_QUEUE_NAME, async (job) => {
  const { workflowID, eventName, value, messageId, clickerUserId } = job.data
  await DBOS.send(workflowID, { value, messageId, clickerUserId }, eventName)
}, { connection, metrics: { maxDataPoints: MetricsTime.ONE_WEEK * 2 } })

resumeWorker.on('failed', (job, err) => {
  error('commandeer', `Resume job ${job?.id} (workflow: ${job?.data?.workflowID}) failed: ${err.message}`)
})

export const quickViewWorker = new Worker(QUICKVIEW_QUEUE_NAME, async (job) => {
  const waitMs = Date.now() - job.timestamp
  if (waitMs > QUEUE_WAIT_WARN_MS) info('commandeer', `Quick view job ${job.id} (${job.data.handler}) started after waiting ${waitMs}ms in queue`)

  const { handler, arg, callbackQueryId, clickerUserId, platform } = job.data
  const entry = findQuickView(handler)
  if (!entry) return

  const text: string | undefined = await (entry.module as any)[entry.methodName](arg, clickerUserId, platform)
  if (!text) return

  await responseQueue.add('answerCallbackQuery', {
    method: 'answerCallbackQuery',
    callbackQueryId,
    content: text,
    chatId: '',
    platform,
  } satisfies PendingResponse)
}, { connection, metrics: { maxDataPoints: MetricsTime.ONE_WEEK * 2 } })

quickViewWorker.on('completed', (job) => {
  info('commandeer', `Quick view job ${job.id} (${job.data.handler}) completed`)
})

quickViewWorker.on('failed', (job, err) => {
  error('commandeer', `Quick view job ${job?.id} (handler: ${job?.data?.handler}) failed: ${err.message}`)
})

const ackPageCallback = (platform: PendingResponse['platform'], callbackQueryId: string | undefined, content: string) =>
  callbackQueryId
    ? responseQueue.add('answerCallbackQuery', {
      method: 'answerCallbackQuery',
      callbackQueryId,
      content,
      chatId: '',
      platform,
    } satisfies PendingResponse)
    : undefined

export const pageWorker = new Worker(PAGE_QUEUE_NAME, async (job) => {
  const waitMs = Date.now() - job.timestamp
  if (waitMs > QUEUE_WAIT_WARN_MS) info('commandeer', `Page job ${job.id} (${job.data.handler}) started after waiting ${waitMs}ms in queue`)

  const { handler, page, authorId, arg, clickerUserId, chatId, messageId, callbackQueryId, platform } = job.data
  const entry = findPage(handler)
  if (!entry) return
  if (entry.restricted && clickerUserId !== authorId) {
    await ackPageCallback(platform, callbackQueryId, 'Essa ação não é sua! 😅')
    return
  }

  const result: {
    content: string
    photoUrl?: string
    hasNext: boolean
    totalPages?: number
    extraRows?: Array<Array<{ text: string; arg: string; page: number }>>
  } | null = await (entry.module as any)[entry.methodName](arg, page, authorId, platform)
  if (!result) {
    await ackPageCallback(platform, callbackQueryId, '')
    return
  }

  const pageButton = (label: string, targetPage: number, targetArg: string = arg) => ({
    text: label,
    callbackData: `pg:${handler}:${targetPage}:${authorId}:${targetArg}`,
  })
  const navRow = pageNavSteps(page, result.hasNext, result.totalPages).map(s => pageButton(s.text, s.page))
  const extraRows = (result.extraRows ?? []).map(row => row.map(b => pageButton(b.text, b.page, b.arg)))
  const buttons = [...extraRows, ...(navRow.length ? [navRow] : [])]

  await Promise.all([
    responseQueue.add('page', {
      method: result.photoUrl ? 'editMessageMedia' : 'editMessageText',
      chatId,
      messageId,
      content: result.content,
      photoUrl: result.photoUrl,
      platform,
      buttons: buttons.length ? buttons : undefined,
    } satisfies PendingResponse),
    ackPageCallback(platform, callbackQueryId, ''),
  ])
}, { connection, metrics: { maxDataPoints: MetricsTime.ONE_WEEK * 2 } })

pageWorker.on('completed', (job) => {
  info('commandeer', `Page job ${job.id} (${job.data.handler}) completed`)
})

pageWorker.on('failed', (job, err) => {
  error('commandeer', `Page job ${job?.id} (handler: ${job?.data?.handler}) failed: ${err.message}`)
})

const shutdown = async () => {
  await Promise.all([commandWorker.close(), resumeWorker.close(), quickViewWorker.close(), pageWorker.close()])
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

