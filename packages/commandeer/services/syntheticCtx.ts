import type { IncomingCommand, Platform } from '@girae/common/commands/types'

// synthetic IncomingCommand pointed at an arbitrary chat/thread, for replying without a real inbound message.
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

// same as sideCtx, but for callers with no base ctx to spread from (e.g. a @QuickView handler).
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
