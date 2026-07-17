import { TelegramClient } from "telegramsjs"

export const tg = new TelegramClient(process.env.TELEGRAM_TOKEN!)

let cachedUsername: string | null = null

export async function getBotUsername(): Promise<string> {
  if (cachedUsername) return cachedUsername
  const me = await tg.getMe()
  cachedUsername = me.username!
  return cachedUsername
}
