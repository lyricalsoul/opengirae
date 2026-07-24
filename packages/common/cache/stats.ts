import { getCached, setCached } from "./kv"
import { StatsDB } from "@girae/database/stats"

const TTL_SECONDS = 30
const CACHE_KEY = "stats:overview"

export async function getOverviewCached(): Promise<Awaited<ReturnType<typeof StatsDB.getOverview>>> {
  const cached = await getCached(CACHE_KEY)
  if (cached) return JSON.parse(cached)

  const overview = await StatsDB.getOverview()
  await setCached(CACHE_KEY, JSON.stringify(overview), TTL_SECONDS)
  return overview
}
