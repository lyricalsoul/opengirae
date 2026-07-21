import { rawClient } from './queue'
import { info } from './logger'


export function startHealthServer(port: number): void {
    Bun.serve({
        port,
        hostname: '0.0.0.0',
        fetch(req) {
            if (new URL(req.url).pathname !== '/health') return new Response('Not Found', { status: 404 })
            return rawClient.isReady ? new Response('OK') : new Response('Redis not connected', { status: 503 })
        },
    })
    info('health', `listening on :${port}/health`)
}
