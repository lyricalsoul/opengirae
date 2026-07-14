import { Worker } from 'bullmq'
import { connection } from '@girae/common/queue'
import { RESPONSE_QUEUE_NAME } from '@girae/common/queue/constants'
import { sendAnswer } from './handler'
import { info, error } from '@girae/common/logger'

const worker = new Worker(RESPONSE_QUEUE_NAME, async (job) => {
  await sendAnswer(job.data)
}, {
  connection,
  concurrency: 5,
})

worker.on('completed', (job) => {
  info('answerer', `Response job ${job.id} completed`)
})

worker.on('failed', (job, err) => {
  error('answerer', `Response job ${job?.id} failed: ${err.message}`)
})

info('answerer', 'Response worker is ready')

const shutdown = async () => {
  await worker.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
