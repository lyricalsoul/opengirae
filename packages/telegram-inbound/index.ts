import type { MessageChat, Message } from '@girae/common/commands/types'
import { TelegramClient } from 'telegramsjs'
import { processCommand } from '@girae/common/inbound/handler'
import { processCallback } from '@girae/common/inbound/callback'
import { info } from '@girae/common/logger'

const tg = new TelegramClient(process.env.TELEGRAM_TOKEN!)

tg.on('ready', () => info('telegram-inbound', `logged in as @${tg.user?.username}`))

const resolveMedia = async (msg: any): Promise<{ photoUrl?: string, isAnimatedPhoto?: boolean }> => {
  if (msg.animation) {
    const file = await msg.animation.fetch()
    return { photoUrl: file.url ?? undefined, isAnimatedPhoto: true }
  }

  if (msg.document?.mimeType?.startsWith('image/')) {
    const file = await msg.document.fetch()
    return { photoUrl: file.url ?? undefined }
  }
  const largest = msg.photo?.[msg.photo.length - 1]
  if (!largest) return {}
  const file = await largest.fetch()
  return { photoUrl: file.url ?? undefined }
}

const stripBotMention = (content: string): string | null => {
  if (!content.startsWith('/')) return content
  const spaceIndex = content.indexOf(' ')
  const firstToken = spaceIndex === -1 ? content : content.slice(0, spaceIndex)
  const atIndex = firstToken.indexOf('@')
  if (atIndex === -1) return content

  const mentionedUsername = firstToken.slice(atIndex + 1)
  if (mentionedUsername.toLowerCase() !== tg.user?.username?.toLowerCase()) return null

  return firstToken.slice(0, atIndex) + content.slice(firstToken.length)
}

const ADDCARD_CHAT_ID = '-1003993142790'
const ADDCARD_THREAD_ID = '6016'

tg.on('message', async (msg) => {
  let content = msg.content ?? msg.caption
  if (String(msg.chat?.id) === ADDCARD_CHAT_ID
    && String(msg.chat?.threadId) === ADDCARD_THREAD_ID
    && msg.photo?.length
    ) {
    content = `/addcard ${content ?? ''}`.trim()
  }

  if (content) {
    const stripped = stripBotMention(content)
    if (stripped === null) return
    content = stripped
  }
  if (!msg.author) return
  if (!content && !msg.photo?.length && !msg.animation) return

  const chat: MessageChat = {
    id: String(msg.chat!.id),
    title: msg.chat!.title || 'DM'
  }

  const replyTo: Message | undefined = msg.originalMessage ? {
    content: msg.originalMessage.content ?? msg.originalMessage.caption ?? '',
    id: String(msg.originalMessage.id),
    author: {
      id: msg.originalMessage.author!.id.toString(),
      name: msg.originalMessage.author!.firstName,
      avatarUrl: ''
    },
    chat,
    timestamp: new Date(msg.originalMessage.createdTimestamp),
    platform: 'telegram',
    ...await resolveMedia(msg.originalMessage)
  } : undefined

  const m: Message = {
    content: content ?? '',
    id: String(msg.id),
    author: {
      id: msg.author!.id.toString(),
      name: msg.author!.firstName,
      avatarUrl: ''
    },
    chat,
    timestamp: new Date(msg.createdTimestamp),
    platform: 'telegram',
    replyTo,
    ...await resolveMedia(msg)
  }

  await processCommand(m)
})

tg.on('callbackQuery', async (data) => {
  if (!data.data) return
  await processCallback(
    data.data,
    data.author.id.toString(),
    data.id,
    data.message?.chat?.id?.toString(),
    data.message?.id?.toString(),
    data.author.firstName
  )
})

const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL

if (webhookUrl) {
  info('telegram-inbound', `registering webhook at ${webhookUrl}`)
  await tg.login({
    webhook: {
      url: webhookUrl,
      host: '0.0.0.0',
      port: parseInt(process.env.PORT ?? '8080', 10),
      secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
      maxConnections: 100,
    }
  })
} else {
  info('telegram-inbound', 'TELEGRAM_WEBHOOK_URL not set, falling back to long polling')
  await tg.login()
}
