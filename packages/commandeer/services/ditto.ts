import { error, warn } from "@girae/common/logger"
import { DEFAULT_BACKGROUND_URL } from "@girae/database/constants"

export { DEFAULT_BACKGROUND_URL }

export interface DittoProfileData {
  avatarURL: string
  username: string
  bio: string
  favoriteColor: string
  reputation: number
  coins: number
  backgroundURL: string
  stickerURL?: string
  profileFrameURL?: string
  favoriteCardName?: string
  favoriteCardImageURL?: string
  favoriteCardRarity?: string
  totalCards: number
  hideBadges: boolean
}

export async function generateProfileImage(data: DittoProfileData, overlays?: string[]): Promise<{ url: string } | null> {
  if (!process.env.DITTO_URL) return null

  return fetch(`${process.env.DITTO_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.DITTO_API_KEY!,
    },
    body: JSON.stringify({
      theme: "default_profile",
      ...(overlays?.length ? { overlays } : {}),
      data: {
        ...data,
        position: 1
      },
      image_pack: "girae",
    }),
  })
    .then(async (r) => {
      if (!r.ok) {
        const body = await r.text().catch(() => '<unreadable>')
        error("ditto", `generateProfileImage HTTP ${r.status}: ${body}`)
        return null
      }
      const text = await r.text()
      try {
        return JSON.parse(text) as { url: string } | null
      } catch (e) {
        error("ditto", `generateProfileImage invalid JSON: ${text}`)
        return null
      }
    })
    .catch((e) => {
      error("ditto", `generateProfileImage failed: ${e}`)
      return null
    })
}
