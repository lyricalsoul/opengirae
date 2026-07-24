import type { Platform } from '../commands/types'

// fired when a user's owned count for a card goes up; previousCount/newCount detect threshold crossings.
export interface CardsNewEvent {
  userId: number
  cardId: number
  previousCount: number
  newCount: number
  telegramId: string
  displayName: string
  platform: Platform
}

export interface HookEventMap {
  'cards:new': CardsNewEvent
}

export type HookEventName = keyof HookEventMap
