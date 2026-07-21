import { mock } from "bun:test"

export interface SentMessage {
  method: string
  [key: string]: any
}

const sentMessages: SentMessage[] = []

mock.module('telegramsjs', () => ({
  TelegramClient: class {
    user = { username: 'test-bot' }
    async sendMessage(args: any) { sentMessages.push({ method: 'sendMessage', ...args }); return { id: `msg-${sentMessages.length}` } }
    async editMessageText(args: any) { sentMessages.push({ method: 'editMessageText', ...args }); return { id: `msg-${sentMessages.length}` } }
    async editMessageCaption(args: any) { sentMessages.push({ method: 'editMessageCaption', ...args }); return { id: `msg-${sentMessages.length}` } }
    async sendPhoto(args: any) { sentMessages.push({ method: 'sendPhoto', ...args }); return { id: `msg-${sentMessages.length}` } }
    async sendAnimation(args: any) { sentMessages.push({ method: 'sendAnimation', ...args }); return { id: `msg-${sentMessages.length}` } }
    async deleteMessage() { }
    async answerCallbackQuery(args: any) { sentMessages.push({ method: 'answerCallbackQuery', ...args }) }
  
    async getChatMember() { return { status: 'member' } }
    async getMe() { return { username: 'test-bot' } }
  },
}))

export function mockTelegram() {
  return { sentMessages }
}
