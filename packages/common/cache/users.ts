import { getCached, setCached, deleteCached } from "./kv"
import { UsersDB, type Platform } from "@girae/database/users"

const TTL_SECONDS = 60 * 60

const cacheKey = (platform: Platform, platformId: string) => `userLookup:${platform}:${platformId}`

export async function getCachedUserId(platform: Platform, platformId: string): Promise<number | undefined> {
  const cached = await getCached(cacheKey(platform, platformId))
  return cached ? Number(cached) : undefined
}

export async function setCachedUserId(platform: Platform, platformId: string, userId: number): Promise<void> {
  await setCached(cacheKey(platform, platformId), String(userId), TTL_SECONDS)
}

export async function invalidateCachedUserId(platform: Platform, platformId: string): Promise<void> {
  await deleteCached(cacheKey(platform, platformId))
}

// only the id is cached, never the row - coins/isAdmin/etc. always come from a fresh read.
export async function getUserByPlatformAccountCached(platform: Platform, platformId: string) {
  const cachedId = await getCachedUserId(platform, platformId)
  if (cachedId !== undefined) return await UsersDB.getUserById(cachedId)

  const user = await UsersDB.getUserByPlatformAccount(platform, platformId)
  if (user) await setCachedUserId(platform, platformId, user.id)
  return user
}
