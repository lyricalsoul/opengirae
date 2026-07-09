import { error } from "@girae/common/logger"
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

export async function generateProfileImage(data: DittoProfileData): Promise<{ url: string } | null> {
  if (!process.env.DITTO_URL) return null

  return fetch(`${process.env.DITTO_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.DITTO_API_KEY!,
    },
    body: JSON.stringify({
      theme: "user_profile",
      data: {
        ...data,
        position: 1
      },
      image_pack: "girae",
    }),
  })
    .then(r => r.json() as Promise<{ url: string } | null>)
    .catch((e) => {
      error("ditto", `generateProfileImage failed: ${e}`)
      return null
    })
}
