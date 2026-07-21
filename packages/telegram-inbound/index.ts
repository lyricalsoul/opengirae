import type { MessageChat, Message } from '@girae/common/commands/types'
import { TelegramClient } from 'telegramsjs'
import { processCommand } from '@girae/common/inbound/handler'
import { processCallback } from '@girae/common/inbound/callback'
import { info, error } from '@girae/common/logger'
import { UsersDB } from '@girae/database/users'
import { commandQueue, responseQueue } from '@girae/common/queue'
import { refreshAvatar } from '@girae/common/avatarRefresh'

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

const refreshAvatarIfStale = (telegramId: string, displayName: string) => refreshAvatar(tg, telegramId, displayName)

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

const ADDCARD_CHAT_IDS = [['-1003993142790', '6016'], ['-1004365766145', '2']]
const ADDBG_CHAT_ID = [['-1003993142790', '10106']]
const CARDIMG_FROM_CAPTION_CHAT_IDS = [['-1003993142790', '46522']]

const isLocalDevelopment = !!process.env.LOCAL_DEVELOPMENT

tg.on('message', async (msg) => {
  let content = msg.content ?? msg.caption

  const matchingChat = ADDCARD_CHAT_IDS.find(([chatId, threadId]) => String(msg.chat?.id) === chatId && String(msg.chat?.threadId) === threadId)
  if (matchingChat && msg.chat?.inTopic && msg.photo?.length && !isLocalDevelopment) {
    content = `/addcard ${content ?? ''}`.trim()
  }

  const matchingBg = ADDBG_CHAT_ID.find(([chatId, threadId]) => String(msg.chat?.id) === chatId && String(msg.chat?.threadId) === threadId)
  if (matchingBg && msg.chat?.inTopic && msg.photo?.length && !isLocalDevelopment) {
    content = `/addbg ${content ?? ''}`.trim()
  }

  const matchingCardImgCaption = CARDIMG_FROM_CAPTION_CHAT_IDS.find(([chatId, threadId]) => String(msg.chat?.id) === chatId && String(msg.chat?.threadId) === threadId)
  if (matchingCardImgCaption && msg.chat?.inTopic && msg.photo?.length ) {
    content = `/cardimgfromcaption ${content ?? ''}`.trim()
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
    title: msg.chat!.title || 'DM',
    threadId: msg.chat?.threadId ? String(msg.chat.threadId) : undefined,
  }

  const isTopicAnchorReply = !!msg.threadId && String(msg.originalMessage?.id) === msg.threadId
  const replyTo: Message | undefined = (msg.originalMessage && !isTopicAnchorReply) ? {
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

  UsersDB.touchUsername('telegram', m.author.id, msg.author!.username, m.author.name).catch(() => undefined)
  await refreshAvatarIfStale(m.author.id, m.author.name)

  await processCommand(m)
})

tg.on('callbackQuery', async (data) => {
  if (!data.data) return
  await refreshAvatarIfStale(data.author.id.toString(), data.author.firstName)
 
  await processCallback(
    data.data,
    data.author.id.toString(),
    data.id,
    'telegram',
    data.message?.chat?.id?.toString(),
    data.message?.id?.toString(),
    data.author.firstName
  )
})

const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL

if (webhookUrl) {
  info('telegram-inbound', `registering webhook at ${webhookUrl}`)

  const path = new URL(webhookUrl).pathname || '/'
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET
  const port = parseInt(process.env.PORT ?? '8080', 10)

  await tg.setWebhook({
    url: webhookUrl,
    secretToken,
    maxConnections: 100,
  })
  tg.user = await tg.getMe()
  tg.readyTimestamp = Date.now()
  tg.emit('ready', tg)

  Bun.serve({
    port,
    hostname: '0.0.0.0',
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname !== path) return new Response(null, { status: 404 })
      if (secretToken && req.headers.get('x-telegram-bot-api-secret-token') !== secretToken) {
        return new Response(null, { status: 403 })
      }

      req.json()
        .then((update) => tg.worker.processUpdate(update))
        .catch((err) => error('telegram-inbound', `failed to parse/process webhook update: ${err}`))

      return new Response('OK', { status: 200 })
    },
  })
} else {
  info('telegram-inbound', 'TELEGRAM_WEBHOOK_URL not set, falling back to long polling')
  const dropPendingUpdates = !!process.env.POLL_DROP_PENDING_UPDATES
  if (dropPendingUpdates) {
    info('telegram-inbound', 'POLL_DROP_PENDING_UPDATES set, dropping pending updates and queued commands on start')
    await commandQueue.drain(true)
    await responseQueue.drain(true)
    tg.polling.offset = 2147483647
    // somehow none of this works...
    // TODO: figure out why telegramjs is trash
  }
  await tg.login({ polling: { dropPendingUpdates, offset: 2147483647 } })
}
