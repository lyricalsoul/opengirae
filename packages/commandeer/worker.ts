import { Worker } from 'bullmq'
import { connection } from '@girae/common/queue'
import { executeCommand } from './services/commands'
import { DBOS } from '@girae/common/dbos'
import { info, error } from '@girae/common/logger'

export const commandWorker = new Worker('{commands}', async (job) => {
  await executeCommand(job.data)
}, { connection })

commandWorker.on('completed', (job) => {
  info('commandeer', `Job ${job.id} (${job.data.name}) completed`)
})

commandWorker.on('failed', (job, err) => {
  error('commandeer', `Job ${job?.id} (${job?.data?.name}) failed: ${err.message}`)
})

export const resumeWorker = new Worker('{resume}', async (job) => {
  const { workflowID, eventName, value, messageId } = job.data
  await DBOS.send(workflowID, { value, messageId }, eventName)
}, { connection })

resumeWorker.on('failed', (job, err) => {
  error('commandeer', `Resume job ${job?.id} (workflow: ${job?.data?.workflowID}) failed: ${err.message}`)
})

