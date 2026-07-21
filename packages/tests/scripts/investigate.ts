// Read-only: prints every BullMQ/DBOS event matching a message/chat/user/workflow ID as one timeline.
import { Pool } from 'pg'
import { commandQueue, responseQueue, resumeQueue, quickViewQueue, pageQueue } from '@girae/common/queue'
import type { Queue, Job } from 'bullmq'

const term = process.argv[2]
if (!term) {
  console.error('Usage: bun run scripts/investigate.ts <message id | chat id | telegram user id | workflow id>')
  process.exit(1)
}

interface TimelineEntry {
  timestamp: number
  source: string
  summary: string
  detail: unknown
}

const entries: TimelineEntry[] = []

const JOB_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'] as const
const JOBS_PER_QUEUE_STATE = 1000

function matches(value: unknown): boolean {
  if (value === null || value === undefined) return false
  return JSON.stringify(value).includes(term!)
}

async function scanQueue(queue: Queue, label: string): Promise<void> {
  for (const state of JOB_STATES) {
    let jobs: Job[]
    try {
      jobs = await queue.getJobs([state], 0, JOBS_PER_QUEUE_STATE)
    } catch {
      continue
    }
    for (const job of jobs) {
      if (!matches(job.data) && !matches(job.returnvalue) && !job.id?.includes(term!)) continue
      entries.push({
        timestamp: job.finishedOn ?? job.processedOn ?? job.timestamp,
        source: `bullmq:${label}:${state}`,
        summary: `job ${job.id} (${job.name}) - ${state}${job.failedReason ? ` - failed: ${job.failedReason}` : ''}`,
        detail: { data: job.data, returnvalue: job.returnvalue, attemptsMade: job.attemptsMade },
      })
    }
  }
}

async function scanDBOS(): Promise<void> {
  const dbosUrl = process.env.DBOS_SYSTEM_DATABASE_URL
  if (!dbosUrl) {
    console.error('DBOS_SYSTEM_DATABASE_URL not set, skipping DBOS system DB scan')
    return
  }
  const pool = new Pool({ connectionString: dbosUrl })

  try {
    const statusRows = await pool.query(
      `SELECT ws.workflow_uuid, ws.status, ws.name, ws.class_name, ws.application_version, ws.created_at, ws.updated_at, ws.error, wi.inputs
       FROM dbos.workflow_status ws
       LEFT JOIN dbos.workflow_inputs wi ON wi.workflow_uuid = ws.workflow_uuid
       WHERE ws.workflow_uuid = $1 OR wi.inputs ILIKE $2
       ORDER BY ws.created_at ASC`,
      [term, `%${term}%`],
    )
    for (const row of statusRows.rows) {
      entries.push({
        timestamp: Number(row.created_at),
        source: 'dbos:workflow_status',
        summary: `workflow ${row.workflow_uuid} (${row.class_name}.${row.name}) - ${row.status}${row.error ? ' - has error' : ''}`,
        detail: { applicationVersion: row.application_version, updatedAt: Number(row.updated_at), error: row.error, inputs: row.inputs },
      })
    }

    const operationRows = await pool.query(
      `SELECT workflow_uuid, function_id, function_name, output, error
       FROM dbos.operation_outputs
       WHERE workflow_uuid = $1 OR output ILIKE $2 OR error ILIKE $2`,
      [term, `%${term}%`],
    )
    for (const row of operationRows.rows) {
      const parentTimestamp = statusRows.rows.find(r => r.workflow_uuid === row.workflow_uuid)
      entries.push({
        timestamp: parentTimestamp ? Number(parentTimestamp.created_at) : 0,
        source: 'dbos:operation_outputs',
        summary: `workflow ${row.workflow_uuid} step ${row.function_id} (${row.function_name})${row.error ? ' - errored' : ''}`,
        detail: { output: row.output, error: row.error },
      })
    }

    const notificationRows = await pool.query(
      `SELECT destination_uuid, topic, message, created_at_epoch_ms, consumed
       FROM dbos.notifications
       WHERE destination_uuid = $1 OR message ILIKE $2`,
      [term, `%${term}%`],
    )
    for (const row of notificationRows.rows) {
      entries.push({
        timestamp: Number(row.created_at_epoch_ms),
        source: 'dbos:notifications',
        summary: `notification to workflow ${row.destination_uuid} on topic "${row.topic}" - consumed=${row.consumed}`,
        detail: { message: row.message },
      })
    }
  } finally {
    await pool.end()
  }
}

async function main() {
  console.log(`Investigating "${term}"...\n`)

  await Promise.all([
    scanQueue(commandQueue, 'commands'),
    scanQueue(responseQueue, 'responses'),
    scanQueue(resumeQueue, 'resume'),
    scanQueue(quickViewQueue, 'quickviews'),
    scanQueue(pageQueue, 'pages'),
    scanDBOS(),
  ])

  entries.sort((a, b) => a.timestamp - b.timestamp)

  if (entries.length === 0) {
    console.log('no matches found in BullMQ queues or DBOS system tables')
  } else {
    for (const entry of entries) {
      const when = entry.timestamp ? new Date(entry.timestamp).toISOString() : '(unknown time)'
      console.log(`[${when}] ${entry.source}\n  ${entry.summary}`)
      console.log(`  ${JSON.stringify(entry.detail).slice(0, 500)}`)
      console.log('')
    }
    console.log(`${entries.length} matching event(s) found.`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
