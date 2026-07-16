import { UsersDB } from '@girae/database/users'
import { CardsDB } from '@girae/database/cards'
import { VanitiesDB } from '@girae/database/vanities'
import { DEFAULT_BACKGROUND_URL, type DittoProfileData } from './ditto'

export async function buildProfileData(
  telegramId: string,
  overrides?: Partial<Pick<DittoProfileData, 'backgroundURL' | 'stickerURL'>>
): Promise<DittoProfileData | null> {
  const profileRow = await UsersDB.getUserProfileByTelegramId(telegramId)
  const user = profileRow?.users
  const profile = profileRow?.user_profiles
  if (!user || !profile) return null

  const equippedIds = [profile.equipedBackgroundId, profile.equipedStickerId, profile.equipedProfileId]
    .filter((id): id is number => id != null)

  const [favoriteCard, vanities, cardsCount] = await Promise.all([
    user.favoriteCardId ? CardsDB.getCardWithDetails(user.favoriteCardId) : null,
    VanitiesDB.getStoreItemsByIds(equippedIds),
    CardsDB.getUserCardsCount(user.id)
  ])

  // avatarUrl is kept fresh by the inbound layer (telegram-inbound's refreshAvatarIfStale,
  // run on every message/callback before the command that reads it here even starts) - no
  // need for this command to refresh it itself.
  const avatarUrl = user.avatarUrl

  const background = vanities.find(v => v.id === profile.equipedBackgroundId)
  const sticker = vanities.find(v => v.id === profile.equipedStickerId)
  const profileFrame = vanities.find(v => v.id === profile.equipedProfileId)

  return {
    avatarURL: avatarUrl,
    username: user.displayName,
    bio: profile.bio,
    favoriteColor: profile.favoriteColor,
    reputation: profile.reputation,
    coins: user.coins,
    backgroundURL: overrides?.backgroundURL ?? background?.itemURL ?? DEFAULT_BACKGROUND_URL,
    stickerURL: overrides?.stickerURL ?? sticker?.itemURL,
    profileFrameURL: profileFrame?.itemURL,
    favoriteCardName: favoriteCard?.name,
    favoriteCardImageURL: favoriteCard?.imageUrl ?? undefined,
    favoriteCardRarity: favoriteCard?.rarityName,
    totalCards: cardsCount,
    hideBadges: profile.hideProfileEmojis
  }
}
