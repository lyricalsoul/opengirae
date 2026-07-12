import { createNodeRedisClient, Queue } from 'bullmq'
import { createClient } from 'redis'

export const rawClient = createClient({ url: process.env.REDIS_URL })
await rawClient.connect()

export const connection = createNodeRedisClient(rawClient)

// on dragonflydb, queue names must be between {}
export const commandQueue = new Queue('{commands}', { connection })
export const responseQueue = new Queue('{responses}', { connection })
export const resumeQueue = new Queue('{resume}', { connection })
export const quickViewQueue = new Queue('{quickviews}', { connection })
export const pageQueue = new Queue('{pages}', { connection })
