import { Worker, DelayedError, MetricsTime } from 'bullmq'
import { connection } from '@girae/common/queue'
import { RESPONSE_QUEUE_NAME } from '@girae/common/queue/constants'
import { sendAnswer } from './handler'
import { info, error } from '@girae/common/logger'

const jobLabel = (data: { method?: string; platform?: string; chatId?: string; messageId?: string } | undefined) =>
  data ? `${data.method}/${data.platform} chat=${data.chatId} msg=${data.messageId ?? '-'}` : 'unknown'

const worker = new Worker(RESPONSE_QUEUE_NAME, async (job, token) => {
  const waitMs = Date.now() - job.timestamp
  if (waitMs > 5000) info('answerer', `Response job ${job.id} (${jobLabel(job.data)}) started after waiting ${waitMs}ms in queue`)

  try {
    return await sendAnswer(job.data)
  } catch (err: any) {
    const retryAfter = err?.parameters?.retry_after
    if (typeof retryAfter === 'number' && token) {
      info('answerer', `Response job ${job.id} (${jobLabel(job.data)}) rate-limited, retrying in ${retryAfter}s`)
      await job.moveToDelayed(Date.now() + retryAfter * 1000, token)
      throw new DelayedError()
    }
    throw err
  }
}, {
  connection,
  concurrency: 5,
  metrics: { maxDataPoints: MetricsTime.ONE_WEEK * 2 },
})

worker.on('completed', (job) => {
  info('answerer', `Response job ${job.id} (${jobLabel(job.data)}) completed`)
})

worker.on('failed', (job, err) => {
  error('answerer', `Response job ${job?.id} (${jobLabel(job?.data)}) failed after ${job?.attemptsMade ?? '?'} attempt(s): ${err.message}`)
})

info('answerer', 'Response worker is ready')

const shutdown = async () => {
  await worker.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
