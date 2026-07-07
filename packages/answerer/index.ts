import { Worker } from 'bullmq'
import { connection } from '@girae/common/queue'
import { sendAnswer } from './handler'
import { info, error } from '@girae/common/logger'

const worker = new Worker('{responses}', async (job) => {
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
