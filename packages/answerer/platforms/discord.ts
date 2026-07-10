import { createRestManager } from '@discordeno/rest'
import { MessageComponentTypes, ButtonStyles } from '@discordeno/types'
import type { PendingResponse } from '@girae/common/commands/types'
import { error } from '@girae/common/logger'

const manager = createRestManager({
  token: process.env.DISCORD_TOKEN!,
})

export async function sendDiscordAnswer(response: PendingResponse) {
  switch (response.method) {
    case 'sendMessage':
      await manager.sendMessage(BigInt(response.chatId), {
        content: response.content,
        ...(response.replyToMessageId ? {
          messageReference: {
            messageId: BigInt(response.replyToMessageId),
            failIfNotExists: false,
          }
        } : {}),
        ...(response.buttons?.length ? {
          components: response.buttons.map(row => ({
            type: MessageComponentTypes.ActionRow,
            components: row.map(b => ({
              type: MessageComponentTypes.Button,
              style: ButtonStyles.Primary,
              label: b.text,
              customId: b.callbackData,
            })) as any
          }))
        } : {})
      })
      break
    default:
      error('answerer', `Unimplemented Discord method: ${response.method}`)
      throw new Error(`Unimplemented Discord method: ${response.method}`)
  }
}
