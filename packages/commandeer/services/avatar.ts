import { TelegramClient } from "telegramsjs"
import { UsersDB } from "@girae/database/users"

const tg = new TelegramClient(process.env.TELEGRAM_TOKEN!)

const AVATAR_TTL_MS = 24 * 60 * 60 * 1000

export async function refreshAvatarIfStale(
  userId: number,
  telegramId: string,
  avatarUrl: string,
  avatarUpdatedAt: Date | null
): Promise<string> {
  const isStale = !avatarUrl || !avatarUpdatedAt || Date.now() - avatarUpdatedAt.getTime() > AVATAR_TTL_MS
  if (!isStale) return avatarUrl

  const photos = await tg.getUserProfilePhotos({ userId: telegramId, limit: 1 })
  const photo = photos?.photos?.[0]?.[0]
  if (!photo) return avatarUrl

  const file = await photo.fetch()
  if (!file.url) return avatarUrl

  await UsersDB.updateAvatar(userId, file.url)
  return file.url
}
