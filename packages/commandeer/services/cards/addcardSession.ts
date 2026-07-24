import { rawClient } from "@girae/common/queue"

const TTL_SECONDS = 6 * 60 * 60 // one staff working session

const key = (chatId: string, threadId?: string) => `addcard:session:${chatId}:${threadId ?? ''}`

export interface AddcardSession {
  subcategoryId: number
  subcategoryName: string
  categoryId: number
  categoryName: string
}

export async function setAddcardSession(chatId: string, threadId: string | undefined, session: AddcardSession): Promise<void> {
  await rawClient.set(key(chatId, threadId), JSON.stringify(session), { EX: TTL_SECONDS })
}

export async function getAddcardSession(chatId: string, threadId: string | undefined): Promise<AddcardSession | null> {
  const raw = await rawClient.get(key(chatId, threadId))
  return raw ? JSON.parse(raw) : null
}
