import type { PendingResponse } from '@girae/common/commands/types'
import { sendDiscordAnswer } from './platforms/discord'
import { sendTelegramAnswer } from './platforms/telegram'

export async function sendAnswer(response: PendingResponse): Promise<string | undefined> {
  if (response.platform === 'none') return

  if (response.platform === 'discord') {
    return sendDiscordAnswer(response)
  } else if (response.platform === 'telegram') {
    return sendTelegramAnswer(response)
  }
}

