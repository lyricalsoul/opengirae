import { error, warn } from "./logger"
import { DEFAULT_BACKGROUND_URL } from "@girae/database/constants"
import { VanitiesDB } from "@girae/database/vanities"
import { buildProfileData } from "./profileData"

export { DEFAULT_BACKGROUND_URL }

export interface DittoMetadata {
  name: string
  engine: string
  scheme: number
  themes: string[]
}

export async function getDittoMetadata(): Promise<DittoMetadata | null> {
  if (!process.env.DITTO_URL) return null

  return fetch(`${process.env.DITTO_URL}/metadata`, { signal: AbortSignal.timeout(3000) })
    .then(async (r) => (r.ok ? await r.json() as DittoMetadata : null))
    .catch((e) => {
      warn("ditto", `getDittoMetadata failed: ${e}`)
      return null
    })
}

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
  favoriteCardColor?: string
  totalCards: number
  hideEmojis?: boolean
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

export interface DittoTradeSide {
  avatarURL: string
  name: string
  cards: string[]
}

export interface DittoTradeData {
  user1: DittoTradeSide
  user2: DittoTradeSide
}

export async function generateTradeImage(data: DittoTradeData): Promise<{ url: string } | null> {
  if (!process.env.DITTO_URL) return null

  return fetch(`${process.env.DITTO_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.DITTO_API_KEY!,
    },
    body: JSON.stringify({
      theme: "default_trade",
      data,
      image_pack: "girae",
    }),
  })
    .then(async (r) => {
      if (!r.ok) {
        const body = await r.text().catch(() => '<unreadable>')
        error("ditto", `generateTradeImage HTTP ${r.status}: ${body}`)
        return null
      }
      const text = await r.text()
      try {
        return JSON.parse(text) as { url: string } | null
      } catch (e) {
        error("ditto", `generateTradeImage invalid JSON: ${text}`)
        return null
      }
    })
    .catch((e) => {
      error("ditto", `generateTradeImage failed: ${e}`)
      return null
    })
}

export interface DittoWishlistCard {
  id: number
  name: string
  imageUrl: string
}

export async function generateWishlistImage(cards: DittoWishlistCard[]): Promise<{ url: string } | null> {
  if (!process.env.DITTO_URL) return null

  return fetch(`${process.env.DITTO_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.DITTO_API_KEY!,
    },
    body: JSON.stringify({
      theme: "wishlist_cards",
      data: cards,
      image_pack: "girae",
    }),
  })
    .then(async (r) => {
      if (!r.ok) {
        const body = await r.text().catch(() => '<unreadable>')
        error("ditto", `generateWishlistImage HTTP ${r.status}: ${body}`)
        return null
      }
      const text = await r.text()
      try {
        return JSON.parse(text) as { url: string } | null
      } catch (e) {
        error("ditto", `generateWishlistImage invalid JSON: ${text}`)
        return null
      }
    })
    .catch((e) => {
      error("ditto", `generateWishlistImage failed: ${e}`)
      return null
    })
}

export async function renderProfile(
  platform: 'telegram' | 'discord',
  telegramId: string,
  overrides?: { backgroundId?: number; stickerId?: number; bio?: string; favoriteColor?: string; favoriteCardColor?: string | null; hideEmojis?: boolean },
): Promise<{ url: string } | null> {
  const [background, sticker] = await Promise.all([
    overrides?.backgroundId ? VanitiesDB.getStoreItemById(overrides.backgroundId) : null,
    overrides?.stickerId ? VanitiesDB.getStoreItemById(overrides.stickerId) : null,
  ])

  const profileData = await buildProfileData(platform, telegramId, {
    ...(background ? { backgroundURL: background.itemURL } : {}),
    ...(sticker ? { stickerURL: sticker.itemURL } : {}),
    ...(overrides?.bio !== undefined ? { bio: overrides.bio } : {}),
    ...(overrides?.favoriteColor !== undefined ? { favoriteColor: overrides.favoriteColor } : {}),
    ...(overrides?.favoriteCardColor !== undefined ? { favoriteCardColor: overrides.favoriteCardColor } : {}),
    ...(overrides?.hideEmojis !== undefined ? { hideEmojis: overrides.hideEmojis } : {}),
  })
  if (!profileData) return null

  return generateProfileImage(profileData)
}

export async function previewItem(platform: 'telegram' | 'discord', telegramId: string, itemId: number): Promise<{ url: string } | null> {
  const item = await VanitiesDB.getStoreItemById(itemId)
  if (!item || item.type === 'profile') return null

  const overrides = item.type === 'background' ? { backgroundURL: item.itemURL } : { stickerURL: item.itemURL }
  const profileData = await buildProfileData(platform, telegramId, overrides)
  if (!profileData) return null

  return generateProfileImage(profileData, ['preview'])
}
