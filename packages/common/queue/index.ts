import { createNodeRedisClient, Queue } from 'bullmq'
import { createClient } from 'redis'

const rawClient = createClient()

export const connection = createNodeRedisClient(rawClient)

// on dragonflydb, queue names must be between {}
export const commandQueue = new Queue('{commands}', { connection })
export const responseQueue = new Queue('{responses}', { connection })
