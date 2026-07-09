import type { MessageAuthor, MessageChat, Message } from '@girae/common/commands/types'
import { avatarUrl, createBot, GatewayIntents } from 'discordeno'
import { processCommand } from './handler'
import { processCallback } from './callback'
import { TelegramClient } from 'telegramsjs'

const tg = new TelegramClient(process.env.TELEGRAM_TOKEN!)

tg.on('message', async (msg) => {
  if (!msg.content) return

  const chat: MessageChat = {
    id: String(msg.chat!.id),
    title: msg.chat!.title || 'DM'
  }

  const replyTo: Message | undefined = msg.originalMessage ? {
    content: msg.originalMessage.content ?? '',
    id: String(msg.originalMessage.id),
    author: {
      id: msg.originalMessage.author!.id.toString(),
      name: msg.originalMessage.author!.firstName,
      avatarUrl: ''
    },
    chat,
    timestamp: new Date(msg.originalMessage.createdTimestamp),
    platform: 'telegram'
  } : undefined

  const m: Message = {
    content: msg.content!,
    id: String(msg.id),
    author: {
      id: msg.author!.id.toString(),
      name: msg.author!.firstName,
      avatarUrl: ''
    },
    chat,
    timestamp: new Date(msg.createdTimestamp),
    platform: 'telegram',
    replyTo
  }

  await processCommand(m)
})

tg.on('callbackQuery', async (data) => {
  if (!data.data) return
  await processCallback(
    data.data,
    data.author.id.toString(),
    data.message?.id?.toString()
  )
})

const bot = createBot({
  token: process.env.DISCORD_TOKEN!,
  intents: GatewayIntents.Guilds | GatewayIntents.MessageContent | GatewayIntents.GuildMessages,
  desiredProperties: {
    user: {
      id: true,
      globalName: true,
      avatar: true,
      accentColor: true,
      discriminator: true
    },
    message: {
      content: true,
      id: true,
      channelId: true,
      author: true,
    },
    channel: {
      id: true,
      name: true
    },
  },
  events: {
    ready: ({ shardId, user }) => console.log(`Shard ${shardId} ready, user id: ${user.id}`),
    messageCreate: async (msg) => {
      if (!msg.author) return

      const author: MessageAuthor = {
        id: msg.author.id.toString(),
        name: msg.author.globalName!,
        avatarUrl: avatarUrl(msg.author.id, msg.author.discriminator)
      }

      const chan = await bot.rest.getChannel(msg.channelId)

      const chat: MessageChat = {
        id: msg.channelId.toString(),
        title: chan.name!
      }

      const m: Message = {
        content: msg.content.replace('!', '/'),
        id: String(msg.id),
        author,
        chat,
        timestamp: new Date(msg.timestamp),
        platform: 'discord'
      }

      await processCommand(m)
    }
  },
})

await Promise.allSettled([
  bot.start(),
  tg.login()
])

