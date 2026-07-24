import type { IncomingCommand, Platform } from '@girae/common/commands/types'

// Builds a synthetic IncomingCommand pointed at an arbitrary chat/thread, so reply()
// can message somewhere other than the chat the triggering ctx came from - a group
// negotiation DM (/trade), the staff review topic, or a player's own private chat,
// none of which need a real inbound message to reply "to".

export function sideCtx(base: IncomingCommand, telegramId: string, name: string, chatId: string, threadId?: string): IncomingCommand {
  return {
    ...base,
    message: {
      ...base.message,
      id: '',
      author: { id: telegramId, name, avatarUrl: '' },
      chat: { id: chatId, title: 'DM', threadId },
    },
  }
}

// Same shape as sideCtx, but for callers with no base ctx to spread from at all
// (a @QuickView handler, which never receives one) - and where the destination
// chat's platform isn't necessarily the clicker's own (e.g. always-Telegram staff topics).
export function buildCtx(platform: Platform, telegramId: string, name: string, chatId: string, threadId?: string): IncomingCommand {
  return {
    name: '',
    args: [],
    workflowIDToBeAssigned: Bun.randomUUIDv7(),
    message: {
      id: '',
      author: { id: telegramId, name, avatarUrl: '' },
      chat: { id: chatId, title: 'DM', threadId },
      content: '',
      timestamp: new Date(),
      platform,
    },
  }
}
