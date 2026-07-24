import { rawClient } from "../queue"

export async function getCached(key: string): Promise<string | undefined> {
  return (await rawClient.get(key)) ?? undefined
}

export async function setCached(key: string, value: string, ttlSeconds: number): Promise<void> {
  await rawClient.set(key, value, { EX: ttlSeconds })
}

export async function deleteCached(key: string): Promise<void> {
  await rawClient.del(key)
}
