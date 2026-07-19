import { UsersDB } from "@girae/database/users"
import { uploadFromUrl } from "./utilities/storage"
import { error } from "./logger"

const AVATAR_TTL_MS = 60 * 60 * 1000

export interface AvatarFetchClient {
  getUserProfilePhotos(opts: { userId: string; limit: number }): Promise<{ photos?: { fetch(): Promise<{ url?: string | null }> }[][] } | undefined>
}

export async function refreshAvatar(
  tg: AvatarFetchClient,
  telegramId: string,
  displayName: string,
  opts: { force?: boolean } = {},
) {
  const user = await UsersDB.ensureUser({ platform: 'telegram', platformId: telegramId, displayName, avatarUrl: '' })
  if (!user) return null

  const isStale = opts.force
    || !user.avatarUrl
    || !user.avatarUpdatedAt
    || Date.now() - user.avatarUpdatedAt.getTime() > AVATAR_TTL_MS
  if (!isStale) return user

  try {
    const photos = await tg.getUserProfilePhotos({ userId: telegramId, limit: 1 })
    const photo = photos?.photos?.[0]?.[0]
    if (!photo) return user

    const file = await photo.fetch()
    if (!file.url) return user

    const avatarUrl = await uploadFromUrl(file.url, 'avatars')
    if (!avatarUrl) return user

    await UsersDB.updateAvatar(user.id, avatarUrl)
    return { ...user, avatarUrl }
  } catch (e) {
    error('avatarRefresh', `failed to refresh avatar for ${telegramId}: ${e}`)
    return user
  }
}
