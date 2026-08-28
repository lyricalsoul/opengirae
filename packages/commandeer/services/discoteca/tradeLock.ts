import { rawClient } from '@girae/common/queue'

const LOCK_TTL_SECONDS = 60 * 60

// separate prefix from services/cards/tradeLock.ts's `trade:lock:` - unrelated locks, not shared.
export const lockKey = (telegramId: string) => `tradedisco:lock:${telegramId}`

export async function tryAcquireLock(telegramId: string, value: { workflowID: string; partnerId: string }): Promise<boolean> {
  const result = await rawClient.set(lockKey(telegramId), JSON.stringify(value), { EX: LOCK_TTL_SECONDS, NX: true })
  return result === 'OK'
}
