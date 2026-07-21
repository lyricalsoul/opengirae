// Preloaded via bunfig.toml so test runs never race a live `bun run dev:*` bot for the same BullMQ jobs.
if (!process.env.BULLMQ_QUEUE_SUFFIX?.startsWith('test')) {
  process.env.BULLMQ_QUEUE_SUFFIX = `test-${process.pid}`
}
