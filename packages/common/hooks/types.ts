import type { Platform } from '../commands/types'

// Fired whenever a user's owned count for a card goes up - a single /girar draw, a
// batch draw, or a trade increment. previousCount/newCount let a listener detect a
// threshold crossing (e.g. previousCount < X <= newCount) without re-querying the DB.
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
