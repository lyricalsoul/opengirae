import type { PendingResponse } from '@girae/common/commands/types'
import { createRestManager } from '@discordeno/rest'
import { TelegramClient } from 'telegramsjs'
import { error } from '@girae/common/logger'

const tg = new TelegramClient(process.env.TELEGRAM_TOKEN!)

const manager = createRestManager({
  token: process.env.DISCORD_TOKEN!,
})

export async function sendAnswer(response: PendingResponse) {
  if (response.platform === 'none') return

  if (response.platform === 'discord') {
    await sendDiscordAnswer(response)
  } else if (response.platform === 'telegram') {
    await sendTelegramAnswer(response)
  }
}

async function sendDiscordAnswer(response: PendingResponse) {
  switch (response.method) {
    case 'sendMessage':
      await manager.sendMessage(BigInt(response.chatId), {
        content: response.content,
        messageReference: {
          messageId: BigInt(response.replyToMessageId!),
          failIfNotExists: false
        }
      })
      break
    default:
      error('answerer', `Unimplemented method: ${response.method}`)
      throw new Error(`Unimplemented method: ${response.method}`)
  }
}

async function sendTelegramAnswer(response: PendingResponse) {
  switch (response.method) {
    case 'sendMessage':
      await tg.sendMessage({
        chatId: response.chatId,
        text: response.content,
        disableNotification: true,
        replyParameters: response.replyToMessageId ? {
          message_id: response.replyToMessageId,
          allow_sending_without_reply: false
        } : undefined
      })
      break
    default:
      error('answerer', `Unimplemented method: ${response.method}`)
      throw new Error(`Unimplemented method: ${response.method}`)
  }
}
